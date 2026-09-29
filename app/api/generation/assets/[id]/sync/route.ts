import { after, NextRequest, NextResponse } from "next/server";
import { generationSchema } from "../../../../../../lib/generation";
import { enqueueImageSync, imageSyncStatus, drainImageSyncQueue } from "../../../../../../lib/generation-image-sync";
import { generationError, generationUser } from "../../../../../../lib/generation-http";
import { uuidPattern } from "../../../../../../lib/generation-model";
export const runtime = "nodejs";
export const maxDuration = 600;
type Context = { params: Promise<{ id: string }> };
async function handle(request: NextRequest, context: Context) {
  try {
    const user = await generationUser(request);
    const { id } = await context.params;
    if (!uuidPattern.test(id)) throw Error("NOT_FOUND");
    await generationSchema();
    const sync = request.method === "POST"
      ? await enqueueImageSync(id, user.openId, request.nextUrl.searchParams.get("retry") === "1")
      : await imageSyncStatus(id, user.openId);
    if (request.method === "POST" && sync.status !== "ready")
      after(async () => { await drainImageSyncQueue(); });
    return NextResponse.json({ success: true, ...sync }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return generationError(e); }
}
export const GET = handle;
export const POST = handle;
