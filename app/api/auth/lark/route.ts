import { NextRequest, NextResponse } from "next/server";
import {
  createOAuthState,
  getLarkConfig,
  isLarkConfigured,
  OAUTH_STATE_COOKIE,
  readOAuthState,
  safeReturnTo,
} from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  const config = getLarkConfig();
  const publicOrigin = config.appUrl || request.url;
  if (!isLarkConfigured())
    return NextResponse.redirect(
      new URL("/login?error=not_configured", publicOrigin),
    );

  const stateCookie = createOAuthState(
    safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
  );
  const oauthState = readOAuthState(stateCookie);
  if (!oauthState)
    return NextResponse.redirect(new URL("/login?error=state", publicOrigin));

  const authorizeUrl = new URL(
    "/open-apis/authen/v1/authorize",
    config.accountsOrigin,
  );
  authorizeUrl.searchParams.set("app_id", config.appId);
  authorizeUrl.searchParams.set("redirect_uri", config.callbackUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", config.scopes);
  authorizeUrl.searchParams.set("state", oauthState.state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, stateCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/lark/callback",
    maxAge: 10 * 60,
  });
  return response;
}
