import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/server-auth";
import { getWeeklyReportData } from "../../../lib/weekly-report-data";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentUser()) return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  try {
    return NextResponse.json({ success: true, ...await getWeeklyReportData() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Weekly report query failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, message: "Weekly report is temporarily unavailable." }, { status: 503 });
  }
}
