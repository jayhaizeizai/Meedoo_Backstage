import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/server-auth";
import { getVideoDetailData } from "../../../../../lib/video-detail-data";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getCurrentUser()))
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  try {
    const data = await getVideoDetailData((await context.params).id);
    if (!data)
      return NextResponse.json(
        { success: false, message: "Video not found." },
        { status: 404 },
      );
    return NextResponse.json(
      { success: true, ...data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Video analytics query failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      {
        success: false,
        message: "Video analytics are temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}
