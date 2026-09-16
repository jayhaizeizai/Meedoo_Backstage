import { createHash } from "node:crypto";
import { db, query } from "./db";
import { cachedMinimaxImageReference, minimaxImageReference } from "./generation-minimax-files";

const credential = () => createHash("sha256").update(process.env.MINIMAX_API_KEY || "").digest("hex");
export async function imageSyncStatus(id: string, owner: string) {
  const row = (await query(`SELECT j.status,j.error_code,j.attempts,
    j.expires_at,j.credential_sha256 FROM generation_assets a
    LEFT JOIN generation_image_sync j ON j.asset_id=a.id
    WHERE a.id=$1 AND a.owner_id=$2`, [id, owner])).rows[0];
  if (!row) throw Error("NOT_FOUND");
  const stale = row.credential_sha256 !== credential() ||
    (row.status === "ready" && new Date(row.expires_at).getTime() <= Date.now() + 600000);
  return { status: stale ? "pending" : row.status || "pending",
    error_code: stale ? null : row.error_code, attempts: row.attempts || 0 };
}
export async function enqueueImageSync(id: string, owner: string, retry = false) {
  if (!process.env.MINIMAX_API_KEY) throw Error("NOT_CONFIGURED");
  await imageSyncStatus(id, owner); // Enforce ownership before any mutation.
  await query(`INSERT INTO generation_image_sync(asset_id,credential_sha256)
    VALUES($1,$2) ON CONFLICT(asset_id) DO UPDATE SET
    status='pending', attempts=0,error_code=NULL,next_attempt_at=now(),credential_sha256=$2
    WHERE generation_image_sync.credential_sha256<>$2
      OR (generation_image_sync.status='ready' AND generation_image_sync.expires_at<=now()+interval '10 minutes')
      OR ($3 AND generation_image_sync.status='failed')`, [id, credential(), retry]);
  // Resolve a cache hit even when all five workers are occupied with uploads.
  const client = await db().connect();
  try {
    const ref = await cachedMinimaxImageReference(id, owner, client);
    if (ref) await client.query(`UPDATE generation_image_sync SET status='ready',error_code=NULL,
      credential_sha256=$2,expires_at=(SELECT min(expires_at) FROM generation_minimax_files
      WHERE owner_id=$3 AND file_id=$4 AND credential_sha256=$2) WHERE asset_id=$1`,
      [id, credential(), owner, ref.slice(10)]);
  } finally { client.release(); }
  return imageSyncStatus(id, owner);
}
export async function processImageSync(id: string, deadline = Date.now() + 330000) {
  const client = await db().connect();
  let locked = false;
  let transferSlot: number | null = null;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,8)) locked", [id])).rows[0].locked;
    if (!locked) return false;
    const job = (await client.query(`SELECT j.*,a.owner_id FROM generation_image_sync j
      JOIN generation_assets a ON a.id=j.asset_id WHERE j.asset_id=$1
      AND j.status IN ('pending','uploading','retrying') AND j.next_attempt_at<=now()`, [id])).rows[0];
    if (!job) return false;
    const keyHash = credential();
    let attempted = false;
    try {
      // Cache hits never wait behind a network transfer or consume an upload slot.
      let ref = await cachedMinimaxImageReference(id, job.owner_id, client);
      if (!ref) {
        if (deadline - Date.now() < 310000) return false;
        for (let slot = 0; slot < 5; slot++) {
          if ((await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,9)) locked", [`minimax-image-transfer:${slot}`])).rows[0].locked) {
            transferSlot = slot;
            break;
          }
        }
        if (transferSlot === null) return false;
        await client.query("UPDATE generation_image_sync SET status='uploading',attempts=attempts+1 WHERE asset_id=$1", [id]);
        attempted = true;
        // Reuse this connection: five transfers must not reserve ten DB connections.
        ref = await minimaxImageReference(id, job.owner_id, deadline, client);
      }
      await client.query(`UPDATE generation_image_sync SET status='ready',error_code=NULL,credential_sha256=$2,
        expires_at=(SELECT min(expires_at) FROM generation_minimax_files WHERE owner_id=$3 AND file_id=$4 AND credential_sha256=$2)
        WHERE asset_id=$1`, [id, keyHash, job.owner_id, ref.slice(10)]);
    } catch (e) {
      const allowed = ["INPUT_UPLOAD_TIMEOUT","INPUT_UPLOAD_NETWORK","INPUT_UPLOAD_TEMPORARY","INPUT_UPLOAD_BUSY"];
      const code = e instanceof Error && allowed.includes(e.message) ? e.message : "INPUT_UPLOAD_FAILED";
      const busy = code === "INPUT_UPLOAD_BUSY";
      const retry = allowed.includes(code) && (busy || job.attempts < 2);
      await client.query(`UPDATE generation_image_sync SET status=$2,error_code=$3,
        attempts=attempts-$4,next_attempt_at=now()+interval '30 seconds' WHERE asset_id=$1`,
        [id, retry ? "retrying" : "failed", code, busy && attempted ? 1 : 0]);
      // Only safe classifications; never log upstream bodies, keys or input content.
      console.warn("MiniMax reference sync", { assetId: id, code, retry });
    }
    return true;
  } finally {
    if (transferSlot !== null) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,9))", [`minimax-image-transfer:${transferSlot}`]);
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,8))", [id]);
    client.release();
  }
}

// Coalesce route callbacks within a process; advisory slots also cap other processes.
let draining: Promise<void> | undefined;
export function drainImageSyncQueue(deadline = Date.now() + 480000): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, async () => {
      while (Date.now() < deadline) {
        const jobs = (await query("SELECT asset_id FROM generation_image_sync WHERE status IN ('pending','uploading','retrying') AND next_attempt_at<=now() ORDER BY next_attempt_at,asset_id LIMIT 50")).rows;
        let progressed = false;
        for (const job of jobs) {
          if (Date.now() >= deadline) break;
          if (await processImageSync(job.asset_id, deadline)) {
            progressed = true;
            break; // Refill this slot immediately, without waiting for a batch or timer.
          }
        }
        if (!progressed) return;
      }
    }));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  })().finally(() => { draining = undefined; });
  return draining;
}
