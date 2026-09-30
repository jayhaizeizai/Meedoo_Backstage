import { uuidPattern } from "./generation-model";
import { historyPage, pagination } from "./generation-pagination";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db, query, transaction } from "./db";
import {
  generationModel,
  generationModels,
  estimateGenerationCost,
  normalizeGenerationUsage,
  validateGeneration,
  type GenerationInput,
} from "./generation-model";

import { minimaxImageReference } from "./generation-minimax-files";
import { enqueueImageSync, imageSyncStatus, drainImageSyncQueue } from "./generation-image-sync";
const run = promisify(execFile);
import {
  ProviderError,
  safeProviderDiagnostic,
  providerConfigured,
  submitGeneration,
  queryGeneration,
} from "./generation-provider";
const directory = () =>
  path.join(process.env.MEEDOO_MEDIA_DIR || "/opt/meedoo/media", "generation");
let schema: Promise<unknown> | undefined;
export async function generationSchema() {
  schema ??= query(`CREATE TABLE IF NOT EXISTS generation_assets (
    id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES meedoo_users(open_id), path text NOT NULL,
    mime text NOT NULL, filename text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS generation_tasks (
    id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES meedoo_users(open_id), owner_name text NOT NULL,
    request_id uuid NOT NULL, provider_id text UNIQUE, requirement text NOT NULL, input jsonb NOT NULL,
    status text NOT NULL, usage jsonb, estimated_cost numeric NOT NULL, pricing_version text NOT NULL DEFAULT 'cn-2026-09-16',
    media_path text, error_code text, last_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,request_id));
    CREATE TABLE IF NOT EXISTS generation_minimax_files (
      owner_id text NOT NULL REFERENCES meedoo_users(open_id), content_sha256 text NOT NULL,
      credential_sha256 text NOT NULL, file_id text NOT NULL, expires_at timestamptz NOT NULL,
      PRIMARY KEY(owner_id,content_sha256,credential_sha256));
    ALTER TABLE generation_tasks ALTER COLUMN estimated_cost DROP NOT NULL;
    CREATE TABLE IF NOT EXISTS generation_image_sync (
      asset_id uuid PRIMARY KEY REFERENCES generation_assets(id),
      status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
      error_code text, next_attempt_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz, credential_sha256 text NOT NULL);
    ALTER TABLE generation_assets ADD COLUMN IF NOT EXISTS media_duration double precision;
    ALTER TABLE generation_assets ADD COLUMN IF NOT EXISTS expires_at timestamptz;
    ALTER TABLE generation_assets ADD COLUMN IF NOT EXISTS file_deleted boolean NOT NULL DEFAULT false;
    ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS provider_error jsonb;
    ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS media_expires_at timestamptz;
    ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS media_deleted_at timestamptz;
    UPDATE generation_tasks SET media_expires_at=updated_at+interval '14 days'
      WHERE media_path IS NOT NULL AND media_expires_at IS NULL;
    CREATE INDEX IF NOT EXISTS generation_tasks_owner_created ON generation_tasks(owner_id,created_at DESC);`).catch(
    (e) => {
      schema = undefined;
      throw e;
    },
  );
  await schema;
}
export async function generationApprover(userId: string) {
  return (
    (await query("SELECT role FROM meedoo_users WHERE open_id=$1", [userId]))
      .rows[0]?.role === "approver"
  );
}
function secret() {
  const s = process.env.MEDIA_URL_SECRET || process.env.SESSION_SECRET;
  if (!s) throw Error("NOT_CONFIGURED");
  return s;
}
function signature(id: string, expires: number) {
  return createHmac("sha256", secret())
    .update(`generation-image:${id}:${expires}`)
    .digest("hex");
}
export function verifyGenerationImage(
  id: string,
  expires: string | null,
  supplied: string | null,
) {
  const n = Number(expires),
    now = Math.floor(Date.now() / 1000);
  if (
    !Number.isInteger(n) ||
    n < now ||
    n > now + 86400 ||
    !supplied ||
    !/^[a-f0-9]{64}$/.test(supplied)
  )
    return false;
  return timingSafeEqual(Buffer.from(signature(id, n)), Buffer.from(supplied));
}
export function imageUrl(id: string) {
  const expires = Math.floor(Date.now() / 1000) + 86400;
  return `${process.env.APP_URL}/api/generation/assets/${id}?expires=${expires}&signature=${signature(id, expires)}`;
}
export async function storeGenerationImage(userId: string, file: File) {
  if (file.size <= 0 || file.size > 30 * 1024 * 1024)
    throw Error("INVALID_IMAGE");
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime = "";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    mime = "image/jpeg";
  else if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    mime = "image/png";
  else if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    mime = "image/webp";
  else if (
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /heic|heix|mif1|heif/.test(bytes.toString("ascii", 8, 32))
  )
    mime = "image/heic";
  if (!mime) throw Error("INVALID_IMAGE");
  await generationSchema();
  const id = randomUUID(),
    filename = path.join(directory(), `${id}.image`);
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
  try {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        filename,
      ],
      { timeout: 15000, maxBuffer: 100000 },
    );
    const size = JSON.parse(stdout).streams?.[0];
    if (
      !size ||
      size.width < 256 ||
      size.height < 256 ||
      size.width > 5760 ||
      size.height > 5760 ||
      size.width / size.height < 0.4 ||
      size.width / size.height > 2.5
    )
      throw Error("INVALID_IMAGE");
    await query(
      "INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,$2,$3,$4,$5)",
      [id, userId, filename, mime, path.basename(file.name).slice(0, 180)],
    );
    return {
      id,
      name: file.name.slice(0, 180),
      url: `/api/generation/assets/${id}`,
    };
  } catch {
    await rm(filename, { force: true });
    throw Error("INVALID_IMAGE");
  }
}
// Reference media is validated locally; provider URLs retain the same signed access policy as images.
export async function storeGenerationReferenceMedia(userId: string, file: File, kind: "video" | "audio") {
  const maxBytes = (kind === "video" ? 50 : 15) * 1024 * 1024;
  const extension = path.extname(file.name).toLowerCase();
  if (!file.size || file.size > maxBytes || !(kind === "video" ? [".mp4", ".mov"] : [".wav", ".mp3"]).includes(extension)) throw Error("INVALID_REFERENCE_MEDIA");
  await generationSchema();
  const id = randomUUID(), filename = path.join(directory(), `${id}${extension}`);
  await mkdir(directory(), {recursive:true, mode:0o700});
  await writeFile(filename, Buffer.from(await file.arrayBuffer()), {mode:0o600, flag:"wx"});
  try {
    const {stdout} = await run("ffprobe", ["-v","error","-protocol_whitelist","file,pipe","-show_entries","format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate","-of","json",filename], {timeout:15000,maxBuffer:100000});
    const metadata = JSON.parse(stdout), duration = Number(metadata.format?.duration);
    const video = metadata.streams?.find((s:any)=>s.codec_type === "video");
    const audio = metadata.streams?.find((s:any)=>s.codec_type === "audio");
    if (!Number.isFinite(duration) || duration < 2 || duration > 15) throw Error("INVALID_REFERENCE_MEDIA");
    if (kind === "video") {
      const [n,d] = String(video?.r_frame_rate).split("/").map(Number), fps=n/d;
      if (!/mov|mp4/.test(metadata.format?.format_name ?? "") || !video || !["h264","hevc"].includes(video.codec_name) || video.width<256 || video.height<256 || video.width>5760 || video.height>5760 || video.width/video.height<0.4 || video.width/video.height>2.5 || !Number.isFinite(fps) || fps<23.97 || fps>60 || (audio && !["aac","mp3"].includes(audio.codec_name))) throw Error("INVALID_REFERENCE_MEDIA");
    } else if (!audio || video || !(extension === ".mp3" ? metadata.format?.format_name === "mp3" : metadata.format?.format_name === "wav")) throw Error("INVALID_REFERENCE_MEDIA");
    const mime = kind === "video" ? (extension === ".mov" ? "video/quicktime" : "video/mp4") : extension === ".mp3" ? "audio/mpeg" : "audio/wav";
    await query("INSERT INTO generation_assets(id,owner_id,path,mime,filename,media_duration,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '14 days')",[id,userId,filename,mime,path.basename(file.name).slice(0,180),duration]);
    return {id,name:file.name.slice(0,180),url:`/api/generation/assets/${id}`,duration};
  } catch { await rm(filename,{force:true}); throw Error("INVALID_REFERENCE_MEDIA"); }
}
export async function createGeneration(
  user: { openId: string; name: string },
  body: unknown,
) {
  const input = validateGeneration(body);
  if (!providerConfigured(input.model)) throw Error("NOT_CONFIGURED");
  await generationSchema();
  const reserved = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,5))", [
      user.openId,
    ]);
    const old = (
      await client.query(
        "SELECT id,input FROM generation_tasks WHERE owner_id=$1 AND request_id=$2",
        [user.openId, input.requestId],
      )
    ).rows[0];
    if (old) {
      if (
        JSON.stringify(old.input) !==
        JSON.stringify(JSON.parse(JSON.stringify(input)))
      ) {
        // jsonb key ordering differs; compare canonical values below.
        const comparable = (v: GenerationInput) => [
          v.model ?? "minimax-h3",
          generationModel(v.model).provider === "ark"
            ? (v.generateAudio ?? true)
            : null,
          v.requirement,
          v.prompt,
          v.mode,
          v.duration,
          v.resolution,
          v.ratio,
          JSON.stringify(v.assets.map((a) => [a.id, a.role])),
        ];
        if (
          JSON.stringify(comparable(old.input)) !==
          JSON.stringify(comparable(input))
        )
          throw Error("REQUEST_CONFLICT");
      }
      return { id: old.id as string, fresh: false };
    }
    const count = (
      await client.query(
        "SELECT count(*)::int n FROM generation_tasks WHERE owner_id=$1 AND status IN ('preparing','submitting','queued','running','submitted_unknown')",
        [user.openId],
      )
    ).rows[0].n;
    if (count >= 3) throw Error("TOO_MANY_TASKS");
    const assets = (
      await client.query(
        "SELECT id,mime,media_duration FROM generation_assets WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND (expires_at IS NULL OR expires_at>now()) AND NOT file_deleted",
        [user.openId, input.assets.map((a) => a.id)],
      )
    ).rows;
    if (assets.length !== input.assets.length) throw Error("INVALID_ASSETS");
    for (const asset of input.assets) {
      const stored = assets.find(a => a.id === asset.id)!;
      const kind = asset.role === "reference_video" ? "video/" : asset.role === "reference_audio" ? "audio/" : "image/";
      if (!stored.mime.startsWith(kind)) throw Error("INVALID_ASSETS");
    }
    for (const role of ["reference_video", "reference_audio"]) {
      const refs = input.assets.filter(a => a.role === role);
      const durations = refs.map(a => Number(assets.find(s => s.id === a.id)?.media_duration));
      if (durations.some(d => !Number.isFinite(d) || d < 2 || d > 15) || durations.reduce((a,b)=>a+b,0)>15.05)
        throw Error("REFERENCE_DURATION_EXCEEDED");
    }
    if (generationModel(input.model).provider === "ark" && input.assets.some(a=>a.role === "reference_audio") && !input.assets.some(a=>a.role === "reference_image" || a.role === "reference_video")) throw Error("INVALID_ASSETS");
    const id = randomUUID();
    await client.query(
      "INSERT INTO generation_tasks(id,owner_id,owner_name,request_id,requirement,input,status,estimated_cost,pricing_version) VALUES($1,$2,$3,$4,$5,$6,$9,$7,$8)",
      [
        id,
        user.openId,
        user.name,
        input.requestId,
        input.requirement,
        JSON.stringify(input),
        generationModel(input.model).provider === "ark"
          ? null
          : estimateGenerationCost(
              input.duration,
              input.resolution,
              input.assets.length,
            ),
        generationModel(input.model).provider === "ark"
          ? "not-estimated"
          : "cn-2026-09-16",
        (generationModel(input.model).provider === "ark" || input.assets.length > 0)
          ? "preparing"
          : "submitting",
      ],
    );
    return { id, fresh: true };
  });
  if (!reserved.fresh) return reserved.id;
  if (
    (generationModel(input.model).provider === "ark" || input.assets.length > 0)
  )
    return reserved.id;
  await submitReservedGeneration(reserved.id, input, imageUrl);
  return reserved.id;
}
async function submitReservedGeneration(
  id: string,
  input: GenerationInput,
  resolveImage: (id: string) => string,
) {
  try {
    const providerId = await submitGeneration(input, resolveImage);
    await query(
      "UPDATE generation_tasks SET provider_id=$2,status='queued',updated_at=now() WHERE id=$1",
      [id, providerId],
    );
  } catch (e) {
    // A timeout or 5xx may have accepted the paid task: never automatically resubmit.
    const definite =
      e instanceof ProviderError &&
      [400, 401, 402, 403, 404, 413, 422, 429].includes(e.status);
    await query(
      "UPDATE generation_tasks SET status=$2,error_code=$3,provider_error=$4,updated_at=now() WHERE id=$1",
      [
        id,
        definite ? "failed" : "submitted_unknown",
        e instanceof ProviderError
          ? e.status === 403
            ? "PROVIDER_ACCESS_DENIED"
            : e.status === 402
              ? "PROVIDER_PAYMENT_REQUIRED"
              : e.message
          : "SUBMISSION_UNCERTAIN",
        e instanceof ProviderError ? JSON.stringify({ http_status: e.status, ...e.diagnostic, code: e.code }) : null,
      ],
    );
  }
}
export async function prepareGeneration(
  id: string,
  deadline = Date.now() + 480000,
) {
  await generationSchema();
  const client = await db().connect();
  let locked = false;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,6)) locked",
        [id],
      )
    ).rows[0].locked;
    if (!locked) return;
    const task = (
      await client.query(
        "SELECT * FROM generation_tasks WHERE id=$1 AND status='preparing'",
        [id],
      )
    ).rows[0];
    if (!task) return;
    await client.query(
      "UPDATE generation_tasks SET last_checked_at=now() WHERE id=$1",
      [id],
    );
    // Ark submission runs durably outside the browser request. The same lock prevents duplicate paid calls.
    if (generationModel(task.input.model).provider === "ark") {
      await client.query("UPDATE generation_tasks SET status='submitting',updated_at=now() WHERE id=$1", [id]);
      await submitReservedGeneration(id, task.input, imageUrl);
      return;
    }
    const refs = new Map<string, string>();
    try {
      for (const asset of task.input.assets.filter((a: GenerationInput["assets"][number]) => !["reference_video", "reference_audio"].includes(a.role)))
        await enqueueImageSync(asset.id, task.owner_id);
      await drainImageSyncQueue(deadline);
      for (const asset of task.input.assets) {
        if (["reference_video", "reference_audio"].includes(asset.role)) { refs.set(asset.id, imageUrl(asset.id)); continue; }
        const sync = await imageSyncStatus(asset.id, task.owner_id);
        if (sync.status === "failed") throw Error("INPUT_UPLOAD_FAILED");
        if (sync.status !== "ready") return;
        refs.set(
          asset.id,
          await minimaxImageReference(asset.id, task.owner_id, deadline),
        );
      }
    } catch (e) {
      // Nothing has been submitted for generation yet. Busy uploads can safely resume next tick.
      if (e instanceof Error && e.message === "INPUT_UPLOAD_BUSY") return;
      await client.query(
        "UPDATE generation_tasks SET status='failed',error_code='INPUT_UPLOAD_FAILED',updated_at=now() WHERE id=$1",
        [id],
      );
      return;
    }
    // Persist the uncertainty boundary before making the paid request; never auto-resubmit beyond it.
    await client.query(
      "UPDATE generation_tasks SET status='submitting',updated_at=now() WHERE id=$1",
      [id],
    );
    await submitReservedGeneration(id, task.input, (assetId) => {
      const ref = refs.get(assetId);
      if (!ref) throw Error("INVALID_ASSETS");
      return ref;
    });
  } finally {
    if (locked)
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,6))", [
        id,
      ]);
    client.release();
  }
}
export function permittedOutput(value: string, model?: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (generationModel(model).provider === "ark"
      ? url.hostname !== "ark-acg-cn-beijing.tos-cn-beijing.volces.com"
      : url.hostname !== "algeng-video-infer.oss-cn-shanghai.aliyuncs.com" &&
        ![
          "hailuoai.com",
          "minimax.io",
          "minimax.cn",
          "minimaxi.com",
          "minimax.chat",
        ].some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)))
  )
    throw Error("OUTPUT_HOST_UNSUPPORTED");
  return url;
}
async function saveOutput(id: string, value: string, model?: string) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const output = path.join(directory(), `${id}.mp4`);
  if ((await stat(output).catch(() => null))?.size) return output;
  let url = permittedOutput(value, model),
    response: Response | undefined;
  for (let i = 0; i < 4; i++) {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(90000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw Error("OUTPUT_DOWNLOAD_FAILED");
      url = permittedOutput(new URL(location, url).href, model);
      continue;
    }
    break;
  }
  if (
    !response?.ok ||
    !response.body ||
    !response.headers.get("content-type")?.match(/video|octet-stream/)
  )
    throw Error("OUTPUT_DOWNLOAD_FAILED");
  const tmp = output + ".part";
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      new Transform({
        transform(chunk, _, done) {
          bytes += chunk.length;
          done(
            bytes > 512 * 1024 * 1024 ? Error("OUTPUT_TOO_LARGE") : null,
            chunk,
          );
        },
      }),
      createWriteStream(tmp, { mode: 0o600 }),
    );
    if (!bytes) throw Error("OUTPUT_DOWNLOAD_FAILED");
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "json",
        tmp,
      ],
      { timeout: 15000 },
    );
    if (!JSON.parse(stdout).streams?.length)
      throw Error("OUTPUT_DOWNLOAD_FAILED");
    await rename(tmp, output);
    return output;
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
export async function refreshGeneration(id: string, userId?: string) {
  await generationSchema();
  const client = await db().connect();
  let locked = false;
  try {
    locked = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,6)) locked",
        [id],
      )
    ).rows[0].locked;
    if (!locked) return;
    const task = (
      await client.query("SELECT * FROM generation_tasks WHERE id=$1", [id])
    ).rows[0];
    if (
      !task ||
      (userId &&
        task.owner_id !== userId &&
        !(await generationApprover(userId)))
    )
      throw Error("NOT_FOUND");
    if (
      task.media_deleted_at ||
      (task.media_expires_at &&
        new Date(task.media_expires_at).getTime() <= Date.now()) ||
      !task.provider_id ||
      ["failed", "cancelled"].includes(task.status) ||
      (task.status === "succeeded" && task.media_path) ||
      (task.last_checked_at &&
        Date.now() - new Date(task.last_checked_at).getTime() < 10000)
    )
      return;
    await client.query(
      "UPDATE generation_tasks SET last_checked_at=now() WHERE id=$1",
      [id],
    );
    const result = await queryGeneration(task.input, task.provider_id);
    if (
      !result ||
      result.id !== task.provider_id ||
      !["queued", "running", "succeeded", "failed", "cancelled"].includes(
        result.status,
      )
    )
      throw Error("INVALID_PROVIDER_RESULT");
    const usage = normalizeGenerationUsage(result.usage);
    await client.query(
      "UPDATE generation_tasks SET status=$2,usage=CASE WHEN $2='succeeded' THEN $3::jsonb ELSE usage END,error_code=$4,provider_error=$5,updated_at=now() WHERE id=$1",
      [
        id,
        result.status,
        JSON.stringify(usage),
        result.status === "failed"
          ? String(result.error?.code) === "2013" &&
            /media url unreachable/i.test(String(result.error?.message))
            ? "INPUT_MEDIA_UNREACHABLE"
            : "GENERATION_FAILED"
          : null,
        result.status === "failed" && generationModel(task.input.model).provider === "ark"
          ? JSON.stringify(safeProviderDiagnostic(result)) : null,
      ],
    );
    if (
      result.status === "succeeded" &&
      !task.media_path &&
      typeof result.content?.url === "string"
    ) {
      try {
        const saved = await saveOutput(
          id,
          result.content.url,
          task.input.model,
        );
        await client.query(
          "UPDATE generation_tasks SET media_path=$2,media_expires_at=COALESCE(media_expires_at,now()+interval '14 days'),error_code=NULL WHERE id=$1",
          [id, saved],
        );
      } catch {
        await client.query(
          "UPDATE generation_tasks SET error_code='OUTPUT_SAVE_PENDING' WHERE id=$1",
          [id],
        );
      }
    }
  } finally {
    if (locked)
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,6))", [
        id,
      ]);
    client.release();
  }
}
// Only generated output files are eligible; uploaded videos and reference images are untouched.
export async function cleanupGenerationOutputs() {
  await generationSchema();
  const expired = await query(
    "SELECT id FROM generation_tasks WHERE media_expires_at<=now() AND media_deleted_at IS NULL ORDER BY media_expires_at LIMIT 100",
  );
  for (const { id } of expired.rows) {
    const client = await db().connect();
    let locked = false;
    try {
      locked = (
        await client.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,6)) locked",
          [id],
        )
      ).rows[0].locked;
      if (!locked) continue;
      const task = (
        await client.query(
          "SELECT media_path FROM generation_tasks WHERE id=$1 AND media_expires_at<=now() AND media_deleted_at IS NULL",
          [id],
        )
      ).rows[0];
      if (!task) continue;
      if (task.media_path) {
        const expected = path.resolve(directory(), `${id}.mp4`);
        if (path.resolve(task.media_path) !== expected)
          throw Error("CLEANUP_PATH_INVALID");
        // Resolve the parent too, so a replaced/symlinked generation directory cannot target uploads.
        if ((await realpath(directory())) !== path.resolve(directory()))
          throw Error("CLEANUP_PATH_INVALID");
        await unlink(expected).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        });
      }
      await client.query(
        "UPDATE generation_tasks SET media_path=NULL,media_deleted_at=now(),error_code=NULL WHERE id=$1",
        [id],
      );
    } catch {
      // Retry on the next timer run without logging private paths or provider data.
      console.error("Generation output cleanup deferred");
    } finally {
      if (locked)
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,6))",
          [id],
        );
      client.release();
    }
  }
}
export async function syncGenerationTasks() {
  const deadline = Date.now() + 480000;
  await cleanupGenerationOutputs();
  if (!process.env.MINIMAX_API_KEY && !process.env.ARK_API_KEY) return;
  await query(
    "UPDATE generation_tasks SET status='submitted_unknown',error_code='SUBMISSION_UNCERTAIN' WHERE status='submitting' AND updated_at<now()-interval '15 minutes'",
  );
  const tasks = await query(
    "SELECT id FROM generation_tasks WHERE provider_id IS NOT NULL AND media_deleted_at IS NULL AND (media_expires_at IS NULL OR media_expires_at>now()) AND (status IN ('queued','running') OR (status='succeeded' AND media_path IS NULL)) AND created_at>now()-interval '7 days' ORDER BY last_checked_at NULLS FIRST LIMIT 5",
  );
  for (const t of tasks.rows) {
    if (Date.now() >= deadline) break;
    try {
      await refreshGeneration(t.id);
    } catch {
      /* Keep durable task for the next sync; never log upstream bodies or credentials. */
    }
  }

  const preparing = await query(
    "SELECT id FROM generation_tasks WHERE status='preparing' ORDER BY last_checked_at NULLS FIRST,created_at LIMIT 2",
  );
  for (const task of preparing.rows) {
    if (Date.now() >= deadline) break;
    try {
      await prepareGeneration(task.id, deadline);
    } catch {
      /* Durable preparation will resume next tick. */
    }
  }
  await drainImageSyncQueue(deadline);
}
export async function generationList(userId: string, requestedPage: unknown = 1, selected?: string | null) {
  await generationSchema();
  const approver = await generationApprover(userId);
  const taskFields = "SELECT id,owner_name,requirement,input,status,usage,estimated_cost,error_code,provider_error,created_at,updated_at,media_expires_at,(media_deleted_at IS NOT NULL OR COALESCE(media_expires_at<=now(),false)) expired,(media_path IS NOT NULL AND media_deleted_at IS NULL AND media_expires_at>now()) available FROM generation_tasks";
  const page = historyPage(requestedPage);
  const total = Number((await query("SELECT count(*) n FROM generation_tasks WHERE owner_id=$1", [userId])).rows[0].n);
  const paging = pagination(total, page, 20);
  const tasks = await query(taskFields + " WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3", [userId,paging.pageSize,(paging.page-1)*paging.pageSize]);
  const recent = await query(taskFields + " WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100", [userId]);
  const selectedTask = selected && uuidPattern.test(selected) ? await query(taskFields + " WHERE owner_id=$1 AND id=$2",[userId,selected]) : {rows:[]};
  const ownTasks = [...new Map([...recent.rows,...tasks.rows,...selectedTask.rows].map(t=>[t.id,t])).values()];
  const totals = await query(
    "SELECT owner_name,requirement,count(*)::int tasks,count(*) FILTER (WHERE status='succeeded')::int succeeded,sum((usage->>'total_tokens')::numeric) tokens,count(*) FILTER (WHERE status='succeeded' AND NOT (COALESCE(usage,'{}') ? 'total_tokens'))::int missing_tokens,sum(estimated_cost) FILTER (WHERE status='succeeded') estimated_cost FROM generation_tasks WHERE owner_id=$1 GROUP BY owner_id,owner_name,requirement ORDER BY owner_name,requirement",
    [userId],
  );
  return {
    configured: Boolean(process.env.MINIMAX_API_KEY || process.env.ARK_API_KEY),
    models: Object.keys(generationModels).filter(providerConfigured),
    approver,
    tasks: tasks.rows,
    ownTasks,
    pagination: paging,
    summary: totals.rows,
  };
}
