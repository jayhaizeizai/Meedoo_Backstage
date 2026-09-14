import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  getLarkConfig,
  MeeDooUser,
  OAUTH_STATE_COOKIE,
  readOAuthState,
  SESSION_COOKIE,
} from "../../../../../lib/auth";
import { upsertUser } from "../../../../../lib/records";

type TokenResponse = {
  code?: number | string;
  msg?: string;
  access_token?: string;
};
type UserInfoResponse = {
  code?: number | string;
  msg?: string;
  data?: {
    open_id?: string;
    user_id?: string;
    name?: string;
    en_name?: string;
    email?: string;
    avatar_url?: string;
    avatar_middle?: string;
    tenant_key?: string;
  };
};

function loginError(request: NextRequest, code: string) {
  return NextResponse.redirect(
    new URL(
      `/login?error=${encodeURIComponent(code)}`,
      getLarkConfig().appUrl || request.url,
    ),
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const oauthState = readOAuthState(cookieStore.get(OAUTH_STATE_COOKIE)?.value);

  if (oauthError) return loginError(request, "denied");
  if (!code || !state || !oauthState || state !== oauthState.state)
    return loginError(request, "state");

  const config = getLarkConfig();
  try {
    const tokenResponse = await fetch(
      `${config.apiOrigin}/open-apis/authen/v2/oauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: config.appId,
          client_secret: config.appSecret,
          code,
          redirect_uri: config.callbackUrl,
        }),
        cache: "no-store",
      },
    );
    const token = (await tokenResponse.json()) as TokenResponse;
    if (
      !tokenResponse.ok ||
      Number(token.code ?? 0) !== 0 ||
      !token.access_token
    )
      return loginError(request, "token");

    const userResponse = await fetch(
      `${config.apiOrigin}/open-apis/authen/v1/user_info`,
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: "no-store",
      },
    );
    const profile = (await userResponse.json()) as UserInfoResponse;
    const data = profile.data;
    if (!userResponse.ok || Number(profile.code ?? 0) !== 0 || !data?.open_id)
      return loginError(request, "profile");

    const user: MeeDooUser = {
      openId: data.open_id,
      userId: data.user_id,
      name: data.name || data.en_name || "Lark user",
      email: data.email,
      avatar: data.avatar_url || data.avatar_middle,
      tenantKey: data.tenant_key,
    };

    await upsertUser(user);

    const response = NextResponse.redirect(
      new URL(oauthState.returnTo, config.appUrl),
    );
    response.cookies.set(SESSION_COOKIE, createSessionToken(user), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/lark/callback",
      maxAge: 0,
    });
    return response;
  } catch {
    return loginError(request, "network");
  }
}
