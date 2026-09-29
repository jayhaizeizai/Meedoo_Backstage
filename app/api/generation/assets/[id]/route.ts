import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { query } from "../../../../../lib/db";
import { getCurrentUser } from "../../../../../lib/server-auth";
import {
  generationSchema,
  verifyGenerationImage,
} from "../../../../../lib/generation";
import { uuidPattern } from "../../../../../lib/generation-model";
import { generationError } from "../../../../../lib/generation-http";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!uuidPattern.test(id)) throw Error("NOT_FOUND");
    await generationSchema();
    const row = (
      await query("SELECT * FROM generation_assets WHERE id=$1", [id])
    ).rows[0];
    if (!row || row.file_deleted || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) throw Error("NOT_FOUND");
    const signed = verifyGenerationImage(
      id,
      request.nextUrl.searchParams.get("expires"),
      request.nextUrl.searchParams.get("signature"),
    );
    if (!signed && (await getCurrentUser())?.openId !== row.owner_id)
      throw Error("NOT_FOUND");
    return new Response(await readFile(row.path), {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(request.nextUrl.searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename="reference-${id}.${row.mime === "video/mp4" ? "mp4" : row.mime === "video/quicktime" ? "mov" : row.mime === "audio/mpeg" ? "mp3" : row.mime === "audio/wav" ? "wav" : row.mime === "image/png" ? "png" : row.mime === "image/webp" ? "webp" : row.mime === "image/heic" ? "heic" : "jpg"}"` } : {}),
      },
    });
  } catch (e) {
    return generationError(e);
  }
}
