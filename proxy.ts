import { NextRequest, NextResponse } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "./lib/auth";

export function proxy(request: NextRequest) {
  if (process.env.LARK_AUTH_REQUIRED !== "true") return NextResponse.next();
  const user = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  const loginUrl = new URL("/login", process.env.APP_URL || request.url);
  loginUrl.searchParams.set(
    "returnTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/upload/:path*",
    "/dashboard/:path*",
    "/records/:path*",
    "/approvals/:path*",
  ],
};
