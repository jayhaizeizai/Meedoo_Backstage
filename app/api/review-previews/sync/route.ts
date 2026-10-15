import { NextRequest, NextResponse } from "next/server";
import { runReviewPreviews } from "../../../../lib/review-preview";
export const runtime = "nodejs";
export const maxDuration = 660;
export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ success: false }, { status: 401 });
  try { await runReviewPreviews(); return NextResponse.json({ success: true }); }
  catch { return NextResponse.json({ success: false }, { status: 503 }); }
}
