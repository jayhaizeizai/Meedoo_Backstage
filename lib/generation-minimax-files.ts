import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, query } from "./db";

// MiniMax retains video_generation_input for seven days; refresh a day early.
const cacheLifetimeMs = 6 * 86400000;
export async function minimaxImageReference(
  assetId: string,
  ownerId: string,
  deadline = Date.now() + 330000,
) {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw Error("NOT_CONFIGURED");
  const asset = (
    await query(
      "SELECT path,mime FROM generation_assets WHERE id=$1 AND owner_id=$2",
      [assetId, ownerId],
    )
  ).rows[0];
  if (!asset) throw Error("INVALID_ASSETS");
  const bytes = await readFile(asset.path);
  if (!bytes.length || bytes.length > 30 * 1024 * 1024)
    throw Error("INVALID_IMAGE");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const credential = createHash("sha256").update(key).digest("hex");
  const lock = `${ownerId}:${digest}:${credential}`;
  const client = await db().connect();
  let locked = false;
  try {
    // A non-blocking lock avoids exhausting the DB pool while another task uploads this image.
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,7)) locked",
        [lock],
      )
    ).rows[0].locked;
    if (!locked) throw Error("INPUT_UPLOAD_BUSY");
    const cached = (
      await client.query(
        "SELECT file_id FROM generation_minimax_files WHERE owner_id=$1 AND content_sha256=$2 AND credential_sha256=$3 AND expires_at>now()+interval '10 minutes'",
        [ownerId, digest, credential],
      )
    ).rows[0];
    if (cached) return `mm_file://${cached.file_id}`;
    const remaining = Math.min(300000, deadline - Date.now());
    if (remaining <= 0) throw Error("INPUT_UPLOAD_BUSY");
    const ext: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
    };
    if (!ext[asset.mime]) throw Error("INVALID_IMAGE");
    const form = new FormData();
    form.set("purpose", "video_generation_input");
    form.set(
      "file",
      new Blob([new Uint8Array(bytes)], { type: asset.mime }),
      `${digest}.${ext[asset.mime]}`,
    );
    const response = await fetch("https://api.minimax.cn/v1/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(remaining),
    }).catch((e: unknown) => {
      throw Error(e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name)
        ? "INPUT_UPLOAD_TIMEOUT" : "INPUT_UPLOAD_NETWORK");
    });
    if (response.status === 429 || response.status >= 500)
      throw Error("INPUT_UPLOAD_TEMPORARY");
    // Preserve int64 file IDs without passing them through JavaScript floating-point numbers.
    const raw = await response.text();
    const result = JSON.parse(
      raw.replace(/("file_id"\s*:\s*)(\d+)/g, '$1"$2"'),
    );
    if (
      !response.ok ||
      result.base_resp?.status_code !== 0 ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(String(result.file?.file_id ?? ""))
    )
      throw Error("INPUT_UPLOAD_FAILED");
    const fileId = String(result.file.file_id);
    const expires = new Date(Date.now() + cacheLifetimeMs);
    await client.query(
      "INSERT INTO generation_minimax_files(owner_id,content_sha256,credential_sha256,file_id,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,content_sha256,credential_sha256) DO UPDATE SET file_id=EXCLUDED.file_id,expires_at=EXCLUDED.expires_at",
      [ownerId, digest, credential, fileId, expires],
    );
    return `mm_file://${fileId}`;
  } finally {
    if (locked)
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,7))", [
        lock,
      ]);
    client.release();
  }
}
