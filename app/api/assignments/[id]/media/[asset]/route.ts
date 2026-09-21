import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { generationUser } from "../../../../../../lib/generation-http";
import { query } from "../../../../../../lib/db";
import { assignmentSchema } from "../../../../../../lib/assignments/schema";
import { assetAttachment, ownedAssignment } from "../../../../../../lib/assignments/data";
import { assignmentId } from "../../../../../../lib/assignments/model";
import { assignmentError } from "../../../../../../lib/assignments/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; asset: string }> }) {
  try {
    const user = await generationUser(request), { id, asset } = await context.params;
    assignmentId(asset); await assignmentSchema(); await ownedAssignment(id, user.openId);
    const video = request.nextUrl.searchParams.get("type") === "video";
    const row = video
      ? (await query(`SELECT g.media_path path,'video/mp4' mime FROM assignment_runs r JOIN generation_tasks g ON g.request_id=r.id AND g.owner_id=r.owner_id
          WHERE r.assignment_id=$1 AND g.id=$2 AND g.status='succeeded' AND g.media_deleted_at IS NULL AND g.media_expires_at>now()`, [id, asset])).rows[0]
      : (await query(`SELECT a.path,a.mime FROM generation_assets a WHERE a.id=$1 AND $2::text IS NOT NULL AND ${assetAttachment} AND NOT a.file_deleted AND (a.expires_at IS NULL OR a.expires_at>now())`, [asset, user.openId, id])).rows[0];
    if (!row?.path) throw Error("NOT_FOUND");
    const info = await stat(row.path); let start = 0, end = info.size - 1, status = 200;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= info.size) return new Response(null, { status: 416 });
      status = 206;
    }
    const headers = new Headers({ "Content-Type": row.mime, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" });
    if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    if (request.nextUrl.searchParams.has("download")) {
      const ext = video ? "mp4" : row.mime === "image/png" ? "png" : row.mime === "image/webp" ? "webp" : "jpg";
      headers.set("Content-Disposition", `attachment; filename="assignment-${asset}.${ext}"`);
    }
    return new Response(Readable.toWeb(createReadStream(row.path, { start, end })) as ReadableStream, { status, headers });
  } catch (e) { return assignmentError(e); }
}
