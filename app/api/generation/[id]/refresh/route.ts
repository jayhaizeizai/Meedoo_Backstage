import { NextRequest, NextResponse } from "next/server";
import { refreshGeneration } from "../../../../../lib/generation";
import {
  generationError,
  generationUser,
} from "../../../../../lib/generation-http";
import { uuidPattern } from "../../../../../lib/generation-model";
export const runtime = "nodejs";
export const maxDuration = 150;
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await generationUser(request);
    const { id } = await params;
    if (!uuidPattern.test(id)) throw Error("NOT_FOUND");
    await refreshGeneration(id, user.openId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return generationError(e);
  }
}
