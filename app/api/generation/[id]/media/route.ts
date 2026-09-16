import { NextRequest } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { query } from "../../../../../lib/db";
import {
  generationApprover,
  generationSchema,
} from "../../../../../lib/generation";
import {
  generationError,
  generationUser,
} from "../../../../../lib/generation-http";
import { uuidPattern } from "../../../../../lib/generation-model";
export const runtime = "nodejs";
async function serve(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  head = false,
) {
  try {
    const user = await generationUser(request);
    const { id } = await params;
    if (!uuidPattern.test(id)) throw Error("NOT_FOUND");
    await generationSchema();
    const row = (
      await query(
        "SELECT owner_id,media_path FROM generation_tasks WHERE id=$1 AND status='succeeded'",
        [id],
      )
    ).rows[0];
    if (
      !row?.media_path ||
      (row.owner_id !== user.openId && !(await generationApprover(user.openId)))
    )
      throw Error("NOT_FOUND");
    const info = await stat(row.media_path);
    let start = 0,
      end = info.size - 1,
      status = 200;
    const range = request.headers.get("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416 });
      if (!m[1]) start = Math.max(0, info.size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= info.size
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      status = 206;
    }
    const headers = new Headers({
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    });
    if (status === 206)
      headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    if (request.nextUrl.searchParams.has("download"))
      headers.set(
        "Content-Disposition",
        `attachment; filename="meedoo-${id}.mp4"`,
      );
    return new Response(
      head
        ? null
        : (Readable.toWeb(
            createReadStream(row.media_path, { start, end }),
          ) as ReadableStream),
      { status, headers },
    );
  } catch (e) {
    return generationError(e);
  }
}
export async function GET(
  r: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  return serve(r, c);
}
export async function HEAD(
  r: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  return serve(r, c, true);
}
