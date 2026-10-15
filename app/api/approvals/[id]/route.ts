import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getReviewRecord } from "../../../../lib/approvals";
import { getReviewPreview } from "../../../../lib/review-preview";

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
  const preview = record.media_path && !record.file_deleted_at
    ? await getReviewPreview(record.id, record.media_path).catch(() => null) : null;
  const originalUrl = `/api/review-media/${record.id}?variant=original`;
  const previewUrl = preview?.path ? `/api/review-media/${record.id}?variant=preview-v1` : null;
  return NextResponse.json({
    success: true,
    record,
    approver,
    history,
    mediaUrl: previewUrl || originalUrl,
    originalUrl, previewUrl, previewStatus: preview?.status || "unavailable",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
