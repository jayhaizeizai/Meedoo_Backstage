import { assignmentsEnabled } from "./lib/feature-settings";
import { NextRequest, NextResponse } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "./lib/auth";

export function proxy(request: NextRequest) {
  const pathname=request.nextUrl.pathname;
  if ((pathname==="/assignments" || pathname.startsWith("/assignments/") || pathname==="/api/assignments" || pathname.startsWith("/api/assignments/")) && !assignmentsEnabled()) {
    return NextResponse.json({success:false,code:"NOT_FOUND"},{status:404,headers:{"Cache-Control":"no-store"}});
  }
  // APIs perform their own JSON authentication rather than redirecting to login.
  if(pathname.startsWith("/api/"))return NextResponse.next();
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
    "/api/assignments/:path*",
    "/assignments/:path*",
    "/generate/:path*",
    "/generation-history/:path*",
    "/upload/:path*",
    "/dashboard/:path*",
    "/records/:path*",
    "/approvals/:path*",
  ],
};
