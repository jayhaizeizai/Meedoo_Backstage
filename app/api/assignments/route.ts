import { NextRequest, NextResponse } from "next/server";
import { generationUser } from "../../../lib/generation-http";
import { assignmentList, createAssignment } from "../../../lib/assignments/data";
import { assignmentBody, assignmentError } from "../../../lib/assignments/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { const user = await generationUser(request); return NextResponse.json(await assignmentList(user.openId, Number(request.nextUrl.searchParams.get("page") || 1)), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return assignmentError(e); }
}
export async function POST(request: NextRequest) {
  try { const user = await generationUser(request); return NextResponse.json({ id: await createAssignment(user.openId, await assignmentBody(request)) }); }
  catch (e) { return assignmentError(e); }
}
