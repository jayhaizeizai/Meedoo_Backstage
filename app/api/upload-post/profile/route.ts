import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getUploadPostConfig, isUploadPostConfigured, parseProviderResponse, providerMessage, supportedPlatforms, uploadPostFetch } from "../../../../lib/upload-post";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentUser()) return NextResponse.json({ configured: false, message: "Authentication required." }, { status: 401 });
  if (!isUploadPostConfigured()) return NextResponse.json({ configured: false, profile: null, connected: {} });
  const { profile } = getUploadPostConfig();

  try {
    const response = await uploadPostFetch(`/api/uploadposts/users/${encodeURIComponent(profile)}`);
    const payload = await parseProviderResponse(response);
    if (!response.ok) return NextResponse.json({ configured: true, profile, connected: {}, message: providerMessage(payload, "Could not read the Upload-Post profile.") }, { status: response.status });
    const socialAccounts = (payload.profile as { social_accounts?: Record<string, unknown> } | undefined)?.social_accounts ?? {};
    const connected = Object.fromEntries(supportedPlatforms.map((platform) => [platform, Boolean(socialAccounts[platform])]));
    return NextResponse.json({ configured: true, profile, connected }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ configured: true, profile, connected: {}, message: "Could not reach Upload-Post." }, { status: 502 });
  }
}
