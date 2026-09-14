import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/server-auth";
import { isApprover } from "../../../lib/approvals";
import { query } from "../../../lib/db";
import { milestoneConfig } from "../../../lib/video-milestones";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false }, { status: 401 });
  if (!(await isApprover(user.openId)))
    return NextResponse.json({ success: false }, { status: 403 });
  const [state, counts, events] = await Promise.all([
    query(
      "SELECT value,updated_at FROM maintenance_state WHERE key='video_milestones'",
    ),
    query(
      "SELECT status,count(*)::int count FROM video_milestone_events GROUP BY status",
    ),
    query(
      "SELECT upload_id,threshold,total_views,status,payload,detected_at,message_id FROM video_milestone_events ORDER BY detected_at DESC,id DESC LIMIT 50",
    ),
  ]);
  return NextResponse.json(
    {
      success: true,
      ...milestoneConfig(),
      state: state.rows[0] ?? null,
      counts: counts.rows,
      events: events.rows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
