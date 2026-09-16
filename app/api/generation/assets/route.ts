import { after, NextRequest, NextResponse } from "next/server";
import { enqueueImageSync, drainImageSyncQueue } from "../../../../lib/generation-image-sync";
import { storeGenerationImage } from "../../../../lib/generation";
import {
  generationError,
  generationUser,
} from "../../../../lib/generation-http";
export const runtime = "nodejs";
export const maxDuration = 600;
export async function POST(request: NextRequest) {
  try {
    const user = await generationUser(request);
    if (Number(request.headers.get("content-length")) > 31 * 1024 * 1024)
      throw Error("INVALID_IMAGE");
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) throw Error("INVALID_IMAGE");
    const asset = await storeGenerationImage(user.openId, file);
    if (data.get("model") === "minimax-h3") {
      await enqueueImageSync(asset.id, user.openId);
      after(async () => { await drainImageSyncQueue(); });
    }
    return NextResponse.json({
      success: true,
      asset,
    });
  } catch (e) {
    return generationError(e);
  }
}
