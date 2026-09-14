import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/server-auth";
import {
  getWeeklyReportData,
  parseReportWeek,
} from "../../../lib/weekly-report-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getCurrentUser()))
    return NextResponse.json(
      { success: false, message: "Authentication required." },
      { status: 401 },
    );
  const now = new Date();
  let selected: Date;
  try {
    selected = parseReportWeek(
      new URL(request.url).searchParams.get("week"),
      now,
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message:
          "Invalid week. Choose a date in the current or an earlier week.",
      },
      { status: 400 },
    );
  }
  try {
    const report = await getWeeklyReportData(selected, now);
    const latest = report.historical
      ? await getWeeklyReportData(selected, now, false)
      : null;
    return NextResponse.json(
      { success: true, ...report, latest },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "Weekly report query failed",
      error instanceof Error ? error.message : "unknown",
    );
    return NextResponse.json(
      { success: false, message: "Weekly report is temporarily unavailable." },
      { status: 503 },
    );
  }
}
