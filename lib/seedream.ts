import { randomUUID } from "node:crypto";
import { readFile, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import { db, query, transaction } from "./db";
import { generationSchema, storeGenerationImage } from "./generation";
import { safeProviderDiagnostic, ProviderError } from "./generation-provider";
import { seedreamModel, seedreamSizes, validateSeedream } from "./seedream-model";

let schema: Promise<unknown> | undefined;
export async function seedreamSchema() {
  await generationSchema();
  schema ??= query(`CREATE TABLE IF NOT EXISTS seedream_tasks (
    id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES meedoo_users(open_id), request_id uuid NOT NULL,
    input jsonb NOT NULL, model text NOT NULL, status text NOT NULL DEFAULT 'queued',
    asset_id uuid REFERENCES generation_assets(id), usage jsonb, provider_error jsonb, error_code text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_id,request_id));
    CREATE INDEX IF NOT EXISTS seedream_owner_created ON seedream_tasks(owner_id,created_at DESC);`).catch(e => { schema = undefined; throw e; });
  await schema;
}
export async function createSeedream(owner: string, value: unknown) {
  const input = validateSeedream(value);
  if (!process.env.ARK_API_KEY) throw Error("NOT_CONFIGURED");
  await seedreamSchema();
  return transaction(async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,41))", [owner]);
    const old = (await c.query("SELECT id,input=$3::jsonb same FROM seedream_tasks WHERE owner_id=$1 AND request_id=$2", [owner, input.requestId, JSON.stringify(input)])).rows[0];
    if (old) { if (!old.same) throw Error("REQUEST_CONFLICT"); return old.id as string; }
    if (input.baseAssetId && !(await c.query("SELECT id FROM generation_assets WHERE id=$1 AND owner_id=$2 AND (expires_at IS NULL OR expires_at>now())", [input.baseAssetId, owner])).rowCount) throw Error("INVALID_ASSETS");
    if (Number((await c.query("SELECT count(*) n FROM seedream_tasks WHERE owner_id=$1 AND status IN ('queued','running')", [owner])).rows[0].n) >= 2) throw Error("TOO_MANY_TASKS");
    const id = randomUUID();
    await c.query("INSERT INTO seedream_tasks(id,owner_id,request_id,input,model) VALUES($1,$2,$3,$4,$5)", [id, owner, input.requestId, JSON.stringify(input), seedreamModel.id]);
    return id;
  });
}
export async function listSeedream(owner: string) {
  await seedreamSchema();
  const result = await query(`SELECT t.id,t.input,t.model,t.status,t.error_code,t.provider_error,t.created_at,t.usage,
    t.asset_id, a.filename, (a.expires_at IS NOT NULL AND a.expires_at<=now()) expired
    FROM seedream_tasks t LEFT JOIN generation_assets a ON a.id=t.asset_id WHERE t.owner_id=$1 ORDER BY t.created_at DESC LIMIT 60`, [owner]);
  const uploads = (await query("SELECT id,filename FROM generation_assets WHERE owner_id=$1 AND expires_at IS NULL AND NOT file_deleted ORDER BY created_at DESC LIMIT 100", [owner])).rows.map(a => ({id:a.id,name:a.filename,url:`/api/generation/assets/${a.id}`}));
  return { configured: Boolean(process.env.ARK_API_KEY), model: seedreamModel.label, uploads, tasks: result.rows.map(t => ({ ...t,
    asset: t.asset_id && !t.expired ? { id: t.asset_id, name: t.filename, url: `/api/generation/assets/${t.asset_id}` } : null,
  })) };
}
async function boundedJSON(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("INVALID_PROVIDER_RESULT");
  const parts: Uint8Array[] = []; let total = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > 42 * 1024 * 1024) throw Error("INVALID_PROVIDER_RESULT"); parts.push(value);
  } } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
// One durable queue worker across app processes. Never repeat an uncertain paid request.
export async function runSeedreamQueue() {
  await seedreamSchema();
  const c = await db().connect(); let locked = false;
  try {
    locked = (await c.query("SELECT pg_try_advisory_lock(741902,41) locked")).rows[0].locked;
    if (!locked) return;
    await c.query("UPDATE seedream_tasks SET status='submitted_unknown',error_code='SUBMISSION_UNCERTAIN',updated_at=now() WHERE status='running' AND updated_at<now()-interval '5 minutes'");
    const task = (await c.query("UPDATE seedream_tasks SET status='running',updated_at=now() WHERE id=(SELECT id FROM seedream_tasks WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING *")).rows[0];
    if (!task) return;
    let sent = false, received = false;
    try {
      let image: string | undefined;
      if (task.input.baseAssetId) {
        const asset = (await c.query("SELECT path,mime FROM generation_assets WHERE id=$1 AND owner_id=$2 AND (expires_at IS NULL OR expires_at>now())", [task.input.baseAssetId, task.owner_id])).rows[0];
        if (!asset) throw Error("INVALID_ASSETS");
        const bytes = await readFile(asset.path);
        if (bytes.length > 30 * 1024 * 1024) throw Error("INVALID_IMAGE");
        image = `data:${asset.mime};base64,${bytes.toString("base64")}`;
      }
      if (!process.env.ARK_API_KEY) throw Error("NOT_CONFIGURED");
      sent = true;
      const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: task.model, prompt: task.input.prompt, size: seedreamSizes[task.input.ratio],
          response_format: "b64_json", output_format: "jpeg", watermark: false, ...(image ? { image } : {}) }),
        signal: AbortSignal.timeout(180000), redirect: "error", cache: "no-store",
      });
      const data = await boundedJSON(response);
      const diagnostic = safeProviderDiagnostic(data, response.headers.get("x-request-id"));
      if (!response.ok || data.error) throw new ProviderError(response.ok ? 400 : response.status, diagnostic.code, diagnostic);
      received = true;
      if (data.data?.[0]?.error) { const d = safeProviderDiagnostic({error: data.data[0].error}, response.headers.get("x-request-id")); throw new ProviderError(400, d.code, d); }
      const encoded = data.data?.[0]?.b64_json;
      if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error("INVALID_PROVIDER_RESULT");
      const bytes = Buffer.from(encoded, "base64");
      const asset = await storeGenerationImage(task.owner_id, new File([bytes], `seedream-${task.id.slice(0,8)}.jpg`, {type:"image/jpeg"}));
      const usage: Record<string, number> = {};
      for (const k of ["input_images", "generated_images", "output_tokens", "total_tokens"]) if (typeof data.usage?.[k] === "number" && Number.isFinite(data.usage[k]) && data.usage[k]>=0) usage[k] = data.usage[k];
      await c.query("UPDATE generation_assets SET expires_at=now()+interval '14 days' WHERE id=$1", [asset.id]);
      await c.query("UPDATE seedream_tasks SET status='succeeded',asset_id=$2,usage=$3,provider_error=$4,updated_at=now() WHERE id=$1", [task.id, asset.id, JSON.stringify(usage), JSON.stringify(diagnostic)]);
    } catch (e) {
      const definite = !sent || received || (e instanceof ProviderError && [400,401,402,403,404,413,422,429].includes(e.status));
      await c.query("UPDATE seedream_tasks SET status=$2,error_code=$3,provider_error=$4,updated_at=now() WHERE id=$1", [task.id,
        definite ? "failed" : "submitted_unknown", e instanceof ProviderError ? e.message : received ? "IMAGE_SAVE_FAILED" : sent ? "SUBMISSION_UNCERTAIN" : "IMAGE_PREPARATION_FAILED",
        e instanceof ProviderError ? JSON.stringify({ ...e.diagnostic, http_status: e.status }) : null]);
    }
  } finally { if (locked) await c.query("SELECT pg_advisory_unlock(741902,41)"); c.release(); }
}
export async function cleanupSeedreamImages() {
  await seedreamSchema();
  const root = path.resolve(process.env.MEEDOO_MEDIA_DIR || "/opt/meedoo/media", "generation");
  const rows = (await query("SELECT id,path FROM generation_assets WHERE expires_at<=now() AND NOT file_deleted LIMIT 100")).rows;
  if (!rows.length) return;
  if (await realpath(root) !== root) throw Error("CLEANUP_PATH_INVALID");
  for (const row of rows) {
    if (path.resolve(row.path) !== path.join(root, `${row.id}.image`)) throw Error("CLEANUP_PATH_INVALID");
    await unlink(row.path).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
    await query("UPDATE generation_assets SET file_deleted=true WHERE id=$1", [row.id]);
  }
}
