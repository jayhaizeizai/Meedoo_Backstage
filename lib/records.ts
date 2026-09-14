import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MeeDooUser } from "./auth";
import { query, transaction } from "./db";
import { UploadPostPlatform } from "./upload-post";

export async function upsertUser(user: MeeDooUser) {
  await query(`INSERT INTO meedoo_users(open_id,user_id,name,email,avatar_url,tenant_key)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(open_id) DO UPDATE SET user_id=excluded.user_id,name=excluded.name,email=excluded.email,
      avatar_url=excluded.avatar_url,tenant_key=excluded.tenant_key,updated_at=now()`,
  [user.openId, user.userId ?? null, user.name, user.email ?? null, user.avatar ?? null, user.tenantKey ?? null]);
}

export async function saveVideo(uploadId: string, file: File) {
  const root = process.env.MEEDOO_MEDIA_DIR;
  if (!root) return null;
  await mkdir(root, { recursive: true });
  const extension = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8) || ".mp4";
  const target = path.join(/* turbopackIgnore: true */ root, `${uploadId}${extension}`);
  await writeFile(target, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  return target;
}

export async function createUpload(input: {
  id: string; requestId: string; profile: string; title: string; caption: string;
  filename: string; size: number; mediaPath: string | null; user: MeeDooUser; platforms: UploadPostPlatform[];
}) {
  await transaction(async (client) => {
    await client.query(`INSERT INTO meedoo_users(open_id,user_id,name,email,avatar_url,tenant_key)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(open_id) DO UPDATE SET name=excluded.name,email=excluded.email,
      avatar_url=excluded.avatar_url,updated_at=now()`,
    [input.user.openId,input.user.userId ?? null,input.user.name,input.user.email ?? null,input.user.avatar ?? null,input.user.tenantKey ?? null]);
    await client.query(`INSERT INTO uploads(id,request_id,profile_username,title,caption,original_filename,media_size_bytes,media_path,uploader_open_id,uploader_name,status,target_platforms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11)`,
    [input.id,input.requestId,input.profile,input.title,input.caption,input.filename,input.size,input.mediaPath,input.user.openId,input.user.name,input.platforms]);
    for (const platform of input.platforms) await client.query(
      `INSERT INTO publications(upload_id,platform,request_id,status) VALUES($1,$2,$3,'queued') ON CONFLICT DO NOTHING`,
      [input.id,platform,input.requestId]);
  });
}

export async function removeRejectedUpload(id: string, message: string) {
  await query(`UPDATE uploads SET status='failed',provider_error=$2,updated_at=now(),completed_at=now() WHERE id=$1`, [id, message]);
  await query(`UPDATE publications SET status='failed',success=false,error_message=$2,updated_at=now() WHERE upload_id=$1`, [id, message]);
}

export async function updateAcceptedUpload(id: string, providerRequestId: string, jobId: string | null, status: string) {
  await query(`UPDATE uploads SET request_id=$2,provider_job_id=$3,status=$4,updated_at=now() WHERE id=$1`, [id,providerRequestId,jobId,status]);
  await query(`UPDATE publications SET request_id=$2,provider_job_id=COALESCE($3,provider_job_id),status=$4,updated_at=now() WHERE upload_id=$1`, [id,providerRequestId,jobId,status]);
}

export function syntheticUuid(seed: string) {
  const hex = createHash("sha256").update(`meedoo:import:${seed}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = "8";
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20,32).join("")}`;
}
