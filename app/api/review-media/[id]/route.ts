import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getReviewRecord } from "../../../../lib/approvals";
import { parseByteRange } from "../../../../lib/http-byte-range";
import { getReviewPreview } from "../../../../lib/review-preview";

type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
async function serve(request: NextRequest, { params }: Context, head = false) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const { record } = await getReviewRecord((await params).id, user);
  if (!record?.media_path || record.file_deleted_at)
    return NextResponse.json(
      { success: false, message: "Media unavailable." },
      { status: 404 },
    );
  const previewRequested = request.nextUrl.searchParams.get("variant") === "preview-v1";
  const preview = previewRequested ? await getReviewPreview(record.id, record.media_path, false).catch(() => null) : null;
  // Never switch representations during range requests: each URL identifies one file.
  const file = previewRequested ? preview?.path : record.media_path;
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info?.isFile() || info.size === 0)
    return NextResponse.json(
      { success: false, message: "Media unavailable." },
      { status: 404 },
    );
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = head ? null : request.headers.get("range");
  if (range) {
    const parsed = parseByteRange(range, info.size);
    if (!parsed) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}`, "Cache-Control": "private, no-store" } });
    ({ start, end } = parsed);
    status = 206;
  }
  const type = previewRequested ? "video/mp4" : record.original_filename?.toLowerCase().endsWith(".webm")
    ? "video/webm"
    : record.original_filename?.toLowerCase().endsWith(".mov")
      ? "video/quicktime"
      : "video/mp4";
  const headers = new Headers({
    "Content-Type": type,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });
  if (status === 206)
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  if (head) return new Response(null, { status, headers });
  return new Response(
    Readable.toWeb(
      createReadStream(file!, { start, end }),
    ) as ReadableStream<Uint8Array>,
    { status, headers },
  );
}
export async function GET(request: NextRequest, context: Context) {
  return serve(request, context);
}
export async function HEAD(request: NextRequest, context: Context) {
  return serve(request, context, true);
}
