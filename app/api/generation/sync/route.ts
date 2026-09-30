import { assignmentsEnabled } from "../../../../lib/feature-settings";
import { runAssignmentPlans } from "../../../../lib/assignments/planner";
import { NextRequest, NextResponse } from "next/server";
import { syncGenerationTasks } from "../../../../lib/generation";
import { runSeedreamQueue, cleanupSeedreamImages } from "../../../../lib/seedream";
export const runtime = "nodejs";
export const maxDuration = 1200;
export async function POST(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ success: false }, { status: 401 });
  try {
    await cleanupSeedreamImages();
    await Promise.all([syncGenerationTasks(), runSeedreamQueue(), ...(assignmentsEnabled() ? [runAssignmentPlans()] : [])]);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 503 });
  }
}
