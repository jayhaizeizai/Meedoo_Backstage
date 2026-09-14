import { removeForCleanup } from "./cleanup-file";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MeeDooUser } from "./auth";
import { query, transaction } from "./db";

export const MAX_VIDEO_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);
export const CHUNK_SIZE = 16 * 1024 * 1024;
export const STAGING_HOURS = 24;
export const READY_HOURS = 72;
export const acceptedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export type UploadSession = {
  id: string; uploader_open_id: string; original_filename: string; content_type: string;
  expected_size: string; chunk_size: number; total_chunks: number; media_path: string | null;
  status: "uploading" | "assembling" | "ready" | "submitted" | "publishing" | "consumed" | "failed";
  expires_at: string;
};

function mediaRoot() {
  const configured = process.env.MEEDOO_MEDIA_DIR;
  if (!configured) throw new Error("MEDIA_STORAGE_NOT_CONFIGURED");
  return path.resolve(configured);
}

function safeExtension(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  return [".mp4", ".mov", ".webm"].includes(extension) ? extension : ".mp4";
}

function chunkDirectory(id: string) {
  return path.join(/* turbopackIgnore: true */ mediaRoot(), ".chunks", id);
}

export function chunkPath(id: string, index: number) {
  return path.join(/* turbopackIgnore: true */ chunkDirectory(id), `${index}.part`);
}

export async function createUploadSession(user: MeeDooUser, input: { filename: string; contentType: string; size: number }) {
  const id = randomUUID();
  const totalChunks = Math.ceil(input.size / CHUNK_SIZE);
  await mkdir(mediaRoot(),{recursive:true,mode:0o700});
  const active=await query<{active_count:string;reserved_bytes:string}>(`SELECT count(*) active_count,COALESCE(sum(expected_size),0) reserved_bytes FROM upload_sessions WHERE uploader_open_id=$1 AND expires_at>now() AND status IN ('uploading','assembling','ready','publishing')`,[user.openId]);
  if(Number(active.rows[0]?.active_count??0)>=3)throw new Error("TOO_MANY_UPLOAD_SESSIONS");
  const disk=await statfs(mediaRoot());const freeBytes=Number(disk.bavail)*Number(disk.bsize);const reserved=Number(active.rows[0]?.reserved_bytes??0);
  if(Number(disk.bavail)/Number(disk.blocks)<=0.05)throw new Error("INSUFFICIENT_STORAGE");
  if(freeBytes<(reserved+input.size)*2+1024*1024*1024)throw new Error("INSUFFICIENT_STORAGE");
  await mkdir(chunkDirectory(id), { recursive: true, mode: 0o700 });
  await transaction(async (client) => {
    await client.query(`INSERT INTO meedoo_users(open_id,user_id,name,email,avatar_url,tenant_key)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(open_id) DO UPDATE SET name=excluded.name,email=excluded.email,
      avatar_url=excluded.avatar_url,updated_at=now()`, [user.openId,user.userId ?? null,user.name,user.email ?? null,user.avatar ?? null,user.tenantKey ?? null]);
    await client.query(`INSERT INTO upload_sessions(id,uploader_open_id,uploader_name,original_filename,content_type,expected_size,chunk_size,total_chunks,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+($9::text||' hours')::interval)`,
    [id,user.openId,user.name,input.filename,input.contentType,input.size,CHUNK_SIZE,totalChunks,STAGING_HOURS]);
  });
  return { id, chunkSize: CHUNK_SIZE, totalChunks, expiresInHours: STAGING_HOURS };
}

export async function getOwnedUploadSession(id: string, openId: string) {
  const result = await query<UploadSession>(`SELECT id,uploader_open_id,original_filename,content_type,expected_size,chunk_size,total_chunks,media_path,status,expires_at
    FROM upload_sessions WHERE id=$1 AND uploader_open_id=$2`, [id,openId]);
  return result.rows[0] ?? null;
}

export async function getReadyUploadSession(id: string, openId?: string) {
  const result = await query<UploadSession>(`SELECT id,uploader_open_id,original_filename,content_type,expected_size,chunk_size,total_chunks,media_path,status,expires_at
    FROM upload_sessions WHERE id=$1 AND ($2::text IS NULL OR uploader_open_id=$2)`, [id,openId ?? null]);
  return result.rows[0] ?? null;
}

export async function receivedChunks(id: string) {
  const result = await query<{ chunk_index: number; size_bytes: number }>(`SELECT chunk_index,size_bytes FROM upload_session_chunks WHERE session_id=$1 ORDER BY chunk_index`, [id]);
  return result.rows;
}

export async function saveChunk(session: UploadSession, index: number, bytes: Uint8Array) {
  const expectedSize = index === session.total_chunks - 1
    ? Number(session.expected_size) - index * session.chunk_size
    : session.chunk_size;
  if (bytes.byteLength !== expectedSize) throw new Error("INVALID_CHUNK_SIZE");
  const target = chunkPath(session.id, index);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, target);
  await query(`INSERT INTO upload_session_chunks(session_id,chunk_index,size_bytes) VALUES($1,$2,$3)
    ON CONFLICT(session_id,chunk_index) DO UPDATE SET size_bytes=excluded.size_bytes,created_at=now()`, [session.id,index,bytes.byteLength]);
}

export async function assembleUploadSession(session: UploadSession) {
  const chunks = await receivedChunks(session.id);
  if (chunks.length !== session.total_chunks || chunks.some((item,index) => item.chunk_index !== index)) throw new Error("MISSING_CHUNKS");
  const total = chunks.reduce((sum,item) => sum + item.size_bytes,0);
  if (total !== Number(session.expected_size)) throw new Error("INVALID_TOTAL_SIZE");
  const locked = await query(`UPDATE upload_sessions SET status='assembling',updated_at=now() WHERE id=$1 AND status='uploading' RETURNING id`, [session.id]);
  if (!locked.rowCount) throw new Error("SESSION_NOT_UPLOADABLE");
  const target = path.join(/* turbopackIgnore: true */ mediaRoot(), `${session.id}${safeExtension(session.original_filename)}`);
  const temporary = `${target}.assembling`;
  const output = await open(temporary,"w",0o600);
  try {
    for (let index=0; index<session.total_chunks; index++) {
      for await (const data of createReadStream(chunkPath(session.id,index))) await output.write(data as Buffer);
    }
    await output.sync();
  } catch (error) {
    await query(`UPDATE upload_sessions SET status='uploading',error_message=$2,updated_at=now() WHERE id=$1`, [session.id,error instanceof Error?error.message:"Assembly failed"]);
    throw error;
  } finally {
    await output.close();
  }
  const assembled = await stat(temporary);
  if (assembled.size !== Number(session.expected_size)) {
    await rm(temporary,{force:true});
    await query(`UPDATE upload_sessions SET status='uploading',error_message='Assembled size mismatch',updated_at=now() WHERE id=$1`, [session.id]);
    throw new Error("ASSEMBLED_SIZE_MISMATCH");
  }
  await rename(temporary,target);
  await rm(chunkDirectory(session.id),{recursive:true,force:true});
  await query(`UPDATE upload_sessions SET status='ready',media_path=$2,error_message=NULL,completed_at=now(),updated_at=now(),expires_at=now()+($3::text||' hours')::interval WHERE id=$1`, [session.id,target,READY_HOURS]);
  return target;
}

export async function cleanupExpiredUploadSessions() {
  const expired = await query<{ id:string; media_path:string|null }>(`SELECT id,media_path FROM upload_sessions s WHERE expires_at<now() AND status IN ('uploading','assembling','ready','failed') AND NOT EXISTS(SELECT 1 FROM uploads u WHERE u.id=s.id OR (s.media_path IS NOT NULL AND u.media_path=s.media_path)) LIMIT 100`);
  let cleaned=0;
  for (const item of expired.rows) {
    if (item.media_path && !await removeForCleanup(item.media_path)) continue;
    if (!await removeForCleanup(chunkDirectory(item.id),true)) continue;
    await query(`DELETE FROM upload_sessions WHERE id=$1`,[item.id]);
    cleaned++;
  }
  return cleaned;
}
