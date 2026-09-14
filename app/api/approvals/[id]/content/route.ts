import { NextRequest, NextResponse } from "next/server";
import { updateReviewContent } from "../../../../../lib/approvals";
import {
  parsePlatformContent,
  validatePlatformContent,
} from "../../../../../lib/platform-content";
import { getCurrentUser } from "../../../../../lib/server-auth";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    platformContent?: unknown;
  };
  const platformContent = parsePlatformContent(body.platformContent);
  if (!platformContent)
    return NextResponse.json(
      {
        success: false,
        message: "A title and caption are required for all three platforms.",
      },
      { status: 400 },
    );
  const validationCode = validatePlatformContent(platformContent);
  if (validationCode)
    return NextResponse.json(
      { success: false, message: validationCode },
      { status: 400 },
    );
  try {
    await updateReviewContent((await params).id, user, platformContent);
    return NextResponse.json({ success: true, platformContent });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "unknown";
    return NextResponse.json(
      { success: false, message: code },
      { status: code === "APPROVER_REQUIRED" ? 403 : 409 },
    );
  }
}
