import { after, NextRequest, NextResponse } from "next/server";
import { generationUser } from "../../../../lib/generation-http";
import { assignmentDetail, editAssignment, generateForAssignment } from "../../../../lib/assignments/data";
import { queueAssignmentPlan, runAssignmentPlans } from "../../../../lib/assignments/planner";
import { assignmentBody, assignmentError } from "../../../../lib/assignments/http";
import { runSeedreamQueue } from "../../../../lib/seedream";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try { const user = await generationUser(request); return NextResponse.json(await assignmentDetail(user.openId, (await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return assignmentError(e); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try { const user = await generationUser(request); await editAssignment(user.openId, (await context.params).id, await assignmentBody(request)); return NextResponse.json({ success: true }); }
  catch (e) { return assignmentError(e); }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await generationUser(request), id = (await context.params).id, body = await assignmentBody(request);
    if (body.action === "plan") {
      const planId = await queueAssignmentPlan(user.openId, id, body);
      after(async () => { try { await runAssignmentPlans(); } catch { /* Timer resumes queued jobs. */ } });
      return NextResponse.json({ id: planId });
    }
    if (body.action !== "storyboard" && body.action !== "video") throw Error("INVALID_INPUT");
    const generationId = await generateForAssignment(user, id, body);
    if (body.action === "storyboard") after(async () => { try { await runSeedreamQueue(); } catch { /* Existing durable queue. */ } });
    return NextResponse.json({ id: generationId });
  } catch (e) { return assignmentError(e); }
}
