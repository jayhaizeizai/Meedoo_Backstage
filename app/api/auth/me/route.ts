import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLarkConfig, isLarkConfigured, readSessionToken, SESSION_COOKIE } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const user = readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  return NextResponse.json(
    { configured: isLarkConfigured(), required: getLarkConfig().required, user },
    { headers: { "Cache-Control": "no-store" } },
  );
}
