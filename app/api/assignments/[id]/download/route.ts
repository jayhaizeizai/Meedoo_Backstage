import { NextRequest, NextResponse } from "next/server";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { generationUser } from "../../../../../lib/generation-http";
import { assignmentSchema } from "../../../../../lib/assignments/schema";
import { ownedAssignment } from "../../../../../lib/assignments/data";
import { assignmentError } from "../../../../../lib/assignments/http";
import { query } from "../../../../../lib/db";
import { zipStream, type ZipEntry } from "../../../../../lib/assignments/zip";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await generationUser(request), id = (await context.params).id;
    await assignmentSchema(); const assignment = await ownedAssignment(id, user.openId);
    const rows = (await query(`SELECT r.id,s.position,s.title,g.status,g.media_path,g.media_deleted_at,g.media_expires_at
      FROM assignment_runs r JOIN assignment_shots s ON s.id=r.shot_id
      LEFT JOIN generation_tasks g ON g.owner_id=r.owner_id AND g.request_id=r.id
      WHERE r.assignment_id=$1 AND r.kind='video' ORDER BY s.position,r.created_at,r.id`, [id])).rows;
    const entries: ZipEntry[] = [], manifest: object[] = [];
    const root = await realpath(path.join(process.env.MEEDOO_MEDIA_DIR || "/opt/meedoo/media", "generation"));
    for (const [index, row] of rows.entries()) {
      let available = false;
      if (row.status === "succeeded" && row.media_path && !row.media_deleted_at && new Date(row.media_expires_at).getTime() > Date.now()) {
        try {
          const file = await realpath(row.media_path), relative = path.relative(root, file);
          if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("INVALID_ASSETS");
          if ((await stat(file)).isFile()) { entries.push({ name: `shot-${String(row.position).padStart(2,"0")}-take-${String(index+1).padStart(3,"0")}.mp4`, path: file }); available = true; }
        } catch { /* Missing / expired files are explicitly listed in the manifest. */ }
      }
      manifest.push({ shot: row.position, title: row.title, run: row.id, status: row.status || "reserved", included: available });
    }
    if (!entries.length) throw Error("NO_DOWNLOADS");
    entries.push({ name: "manifest.json", bytes: Buffer.from(JSON.stringify({ title: assignment.title, exportedAt: new Date().toISOString(), videos: manifest }, null, 2)) });
    const stream = await zipStream(entries, request.signal);
    if (request.nextUrl.searchParams.has("check")) { await stream.cancel(); return NextResponse.json({ success: true, count: entries.length - 1 }); }
    return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="assignment-${id}.zip"`, "Cache-Control": "private, no-store" } });
  } catch (e) { return assignmentError(e); }
}
