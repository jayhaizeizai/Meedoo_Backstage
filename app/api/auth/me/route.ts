import { getEnabledPlatforms } from "../../../../lib/platform-settings";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getLarkConfig,
  isLarkConfigured,
  readSessionToken,
  SESSION_COOKIE,
} from "../../../../lib/auth";
import { getUserRole } from "../../../../lib/approvals";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const user = readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  const role = user ? await getUserRole(user.openId) : "member";
  return NextResponse.json(
    {
      configured: isLarkConfigured(),
      required: getLarkConfig().required,
      user,
      role,
      enabledPlatforms: getEnabledPlatforms(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
