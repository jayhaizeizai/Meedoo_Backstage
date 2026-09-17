import { NextRequest, NextResponse } from "next/server";
import { createGeneration, generationList } from "../../../lib/generation";
import { generationError, generationUser } from "../../../lib/generation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const user = await generationUser(request);
    return NextResponse.json(
      { success: true, ...(await generationList(user.openId, request.nextUrl.searchParams.get("page") ?? 1, request.nextUrl.searchParams.get("selected"))) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return generationError(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await generationUser(request);
    const text = await request.text();
    if (text.length > 40000) throw Error("INVALID_INPUT");
    const id = await createGeneration(user, JSON.parse(text));
    return NextResponse.json({ success: true, id });
  } catch (e) {
    return generationError(e);
  }
}
