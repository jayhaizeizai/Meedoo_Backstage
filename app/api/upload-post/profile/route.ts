import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import {
  getUploadPostConfig,
  isUploadPostConfigured,
  parseProviderResponse,
  providerMessage,
  supportedPlatforms,
  uploadPostFetch,
} from "../../../../lib/upload-post";

export const dynamic = "force-dynamic";
let cached:
  | {
      profile: string;
      expires: number;
      connected: Record<string, boolean>;
      available: Record<string, boolean>;
    }
  | undefined;

export async function GET() {
  if (!(await getCurrentUser()))
    return NextResponse.json(
      { configured: false, message: "Authentication required." },
      { status: 401 },
    );
  if (!isUploadPostConfigured())
    return NextResponse.json({
      configured: false,
      profile: null,
      connected: {},
    });
  const { profile, facebookPageId } = getUploadPostConfig();
  if (cached?.profile === profile && cached.expires > Date.now())
    return NextResponse.json(
      {
        configured: true,
        profile,
        connected: cached.connected,
        available: cached.available,
        facebookPageConfigured: Boolean(facebookPageId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );

  try {
    const response = await uploadPostFetch(
      `/api/uploadposts/users/${encodeURIComponent(profile)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const payload = await parseProviderResponse(response);
    if (!response.ok)
      return NextResponse.json(
        {
          configured: true,
          profile,
          connected: {},
          message: providerMessage(
            payload,
            "Could not read the Upload-Post profile.",
          ),
        },
        { status: response.status },
      );
    const socialAccounts =
      (
        payload.profile as
          | { social_accounts?: Record<string, unknown> }
          | undefined
      )?.social_accounts ?? {};
    const connected = Object.fromEntries(
      supportedPlatforms.map((platform) => [
        platform,
        Boolean(socialAccounts[platform]),
      ]),
    );
    const available = {
      ...connected,
      facebook: connected.facebook && Boolean(facebookPageId),
    };
    cached = { profile, expires: Date.now() + 60_000, connected, available };
    return NextResponse.json(
      {
        configured: true,
        profile,
        connected,
        available,
        facebookPageConfigured: Boolean(facebookPageId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        configured: true,
        profile,
        connected: {},
        message: "Could not reach Upload-Post.",
      },
      { status: 502 },
    );
  }
}
