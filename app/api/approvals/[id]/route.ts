import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getReviewRecord } from "../../../../lib/approvals";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  const { record, approver, history } = await getReviewRecord(
    (await params).id,
    user,
  );
  if (!record)
    return NextResponse.json(
      { success: false, message: "Upload not found." },
      { status: 404 },
    );
  return NextResponse.json({
    success: true,
    record,
    approver,
    history,
    mediaUrl: `/api/review-media/${record.id}`,
  });
}
