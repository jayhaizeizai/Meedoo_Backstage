import { NextResponse } from "next/server";
import { generationError } from "../generation-http";
export function assignmentError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNAVAILABLE";
  const codes: Record<string, number> = { SHOTS_HAVE_GENERATIONS: 409, GENERATION_PENDING: 409, NO_DOWNLOADS: 409, ARCHIVE_TOO_LARGE: 413 };
  return codes[code] ? NextResponse.json({ success: false, code }, { status: codes[code] }) : generationError(error);
}
export async function assignmentBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 60000) throw Error("INVALID_INPUT");
  try { const body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw Error(); return body as Record<string, unknown>; }
  catch { throw Error("INVALID_INPUT"); }
}
