import { stat, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db, query } from "./db";
const exec = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = () => path.join(process.env.MEEDOO_MEDIA_DIR || "/var/lib/meedoo/media", "review-previews-v1");
function output(id: string) { if (!uuid.test(id)) throw Error("INVALID_ID"); return path.join(root(), id + ".mp4"); }
let schema: Promise<unknown> | undefined;
export function reviewPreviewSchema() {
  return schema ??= query(`CREATE TABLE IF NOT EXISTS review_previews (
    upload_id uuid PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
    source_signature text, updated_at timestamptz NOT NULL DEFAULT now(),
    retry_at timestamptz NOT NULL DEFAULT now()
  )`).catch(e => { schema = undefined; throw e; });
}
async function signature(file: string) {
  const s = await stat(file); if (!s.isFile() || !s.size) throw Error("SOURCE_MISSING");
  return `${file}:${s.size}:${s.mtimeMs}`;
}
export async function getReviewPreview(id: string, source: string, enqueue = true) {
  await reviewPreviewSchema();
  const sig = await signature(source);
  const row = (await query("SELECT status,source_signature FROM review_previews WHERE upload_id=$1", [id])).rows[0];
  if (row?.status === "ready" && row.source_signature === sig) {
    const file = output(id), s = await stat(file).catch(() => null);
    if (s?.isFile() && s.size > 0) return { status: "ready", path: file };
  }
  if (enqueue) {
    await query(`INSERT INTO review_previews(upload_id) VALUES($1) ON CONFLICT(upload_id) DO UPDATE
      SET status='queued',attempts=0,retry_at=now(),updated_at=now()
      WHERE review_previews.status='ready'`, [id]);
  }
  return { status: row?.status === "failed" ? "failed" : "queued", path: null };
}

// One global worker lock, two CPU threads, bounded attempts and atomic output promotion.
// This queue never submits generation or publishes video.
export async function runReviewPreviews() {
  await reviewPreviewSchema();
  const c = await db().connect(); let locked = false;
  try {
    locked = (await c.query("SELECT pg_try_advisory_lock(72384619) locked")).rows[0].locked;
    if (!locked) return;
    await mkdir(root(), { recursive: true, mode: 0o700 });
    await c.query("UPDATE review_previews SET status='queued' WHERE status='running'");
    await c.query(`INSERT INTO review_previews(upload_id)
      SELECT id FROM uploads WHERE review_status='pending' AND removed_at IS NULL
      AND file_deleted_at IS NULL AND media_path IS NOT NULL ON CONFLICT DO NOTHING`);
    const obsolete = (await c.query(`SELECT p.upload_id FROM review_previews p JOIN uploads u ON u.id=p.upload_id
      WHERE u.removed_at IS NOT NULL OR u.file_deleted_at IS NOT NULL OR u.review_status='withdrawn'`)).rows;
    for (const row of obsolete) {
      await unlink(output(row.upload_id)).catch(() => {});
      await c.query("DELETE FROM review_previews WHERE upload_id=$1", [row.upload_id]);
    }
    const jobs = (await c.query(`SELECT p.upload_id,u.media_path FROM review_previews p JOIN uploads u ON u.id=p.upload_id
      WHERE p.status IN ('queued','failed') AND p.attempts<3 AND p.retry_at<=now()
      AND u.removed_at IS NULL AND u.file_deleted_at IS NULL AND u.media_path IS NOT NULL AND u.review_status<>'withdrawn'
      ORDER BY p.updated_at LIMIT 1`)).rows;
    for (const job of jobs) {
      const dest = output(job.upload_id), temp = dest + ".tmp.mp4";
      await unlink(temp).catch(() => {});
      await c.query("UPDATE review_previews SET status='running',attempts=attempts+1,updated_at=now() WHERE upload_id=$1", [job.upload_id]);
      try {
        const before = await signature(job.media_path);
        await exec("nice", ["-n", "10", "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-i", job.media_path,
          "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
          "-vf", "scale=w='min(720,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "2M", "-bufsize", "4M",
          "-pix_fmt", "yuv420p", "-threads", "2", "-filter_threads", "1", "-c:a", "aac", "-b:a", "96k", "-ac", "2",
          "-movflags", "+faststart", temp], { timeout: 600000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
        if (await signature(job.media_path) !== before || !(await stat(temp)).size) throw Error("SOURCE_CHANGED");
        const valid = await c.query("SELECT id FROM uploads WHERE id=$1 AND media_path=$2 AND removed_at IS NULL AND file_deleted_at IS NULL AND review_status<>'withdrawn'", [job.upload_id, job.media_path]);
        if (!valid.rowCount) throw Error("SOURCE_REMOVED");
        await rename(temp, dest);
        await c.query("UPDATE review_previews SET status='ready',source_signature=$2,updated_at=now() WHERE upload_id=$1", [job.upload_id, before]);
      } catch {
        await unlink(temp).catch(() => {});
        await c.query("UPDATE review_previews SET status='failed',retry_at=now()+interval '5 minutes',updated_at=now() WHERE upload_id=$1", [job.upload_id]);
      }
    }
  } finally {
    if (locked) await c.query("SELECT pg_advisory_unlock(72384619)");
    c.release();
  }
}
