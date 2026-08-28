import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "meedoo_session";
export const OAUTH_STATE_COOKIE = "meedoo_lark_oauth";

export type MeeDooUser = {
  openId: string;
  userId?: string;
  name: string;
  email?: string;
  avatar?: string;
  tenantKey?: string;
};

type SessionPayload = MeeDooUser & {
  iat: number;
  exp: number;
};

const encode = (value: string) => Buffer.from(value).toString("base64url");

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(user: MeeDooUser) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");

  const now = Math.floor(Date.now() / 1000);
  const payload = encode(JSON.stringify({ ...user, iat: now, exp: now + 60 * 60 * 24 * 7 } satisfies SessionPayload));
  return `${payload}.${signature(payload, secret)}`;
}

export function readSessionToken(token?: string): MeeDooUser | null {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret || secret.length < 32) return null;

  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;

  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!session.openId || !session.name || session.exp <= Math.floor(Date.now() / 1000)) return null;
    const { iat: _iat, exp: _exp, ...user } = session;
    return user;
  } catch {
    return null;
  }
}

export function createOAuthState(returnTo: string) {
  return encode(JSON.stringify({ state: randomBytes(32).toString("base64url"), returnTo }));
}

export function readOAuthState(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { state?: string; returnTo?: string };
    if (!parsed.state) return null;
    return { state: parsed.state, returnTo: safeReturnTo(parsed.returnTo) };
  } catch {
    return null;
  }
}

export function safeReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/upload";
  return value;
}

export function getLarkConfig() {
  const brand = process.env.LARK_BRAND === "feishu" ? "feishu" : "lark";
  const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const accountsOrigin = brand === "feishu" ? "https://accounts.feishu.cn" : "https://accounts.larksuite.com";
  const apiOrigin = brand === "feishu" ? "https://open.feishu.cn" : "https://open.larksuite.com";

  return {
    appId: process.env.LARK_APP_ID ?? "",
    appSecret: process.env.LARK_APP_SECRET ?? "",
    appUrl,
    accountsOrigin,
    apiOrigin,
    scopes: process.env.LARK_SCOPES ?? "auth:user.id:read",
    callbackUrl: `${appUrl}/api/auth/lark/callback`,
    required: process.env.LARK_AUTH_REQUIRED === "true",
  };
}

export function isLarkConfigured() {
  const config = getLarkConfig();
  return Boolean(config.appId && config.appSecret && config.appUrl && (process.env.SESSION_SECRET?.length ?? 0) >= 32);
}
