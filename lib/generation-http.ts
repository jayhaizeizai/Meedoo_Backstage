import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "./server-auth";
export async function generationUser(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) throw Error("UNAUTHORIZED");
  const origin = request.headers.get("origin");
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    origin &&
    origin !== new URL(process.env.APP_URL!).origin
  )
    throw Error("FORBIDDEN");
  return user;
}
export function generationError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNAVAILABLE";
  const known: Record<string, number> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    NOT_CONFIGURED: 503,
    INVALID_INPUT: 400,
    INVALID_IMAGE: 400,
    INVALID_REFERENCE_MEDIA: 400,
    REFERENCE_DURATION_EXCEEDED: 400,
    INVALID_ASSETS: 400,
    TOO_MANY_TASKS: 429,
    REQUEST_CONFLICT: 409,
  };
  return NextResponse.json(
    { success: false, code: code in known ? code : "UNAVAILABLE" },
    { status: known[code] || 503 },
  );
}
