import { after, NextRequest, NextResponse } from "next/server";
import { generationError, generationUser } from "../../../../lib/generation-http";
import { createSeedream, listSeedream, runSeedreamQueue } from "../../../../lib/seedream";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function GET(request: NextRequest) {
  try { const user = await generationUser(request); return NextResponse.json(await listSeedream(user.openId,request.nextUrl.searchParams.get("page")??1,request.nextUrl.searchParams.get("tracked")), {headers:{"Cache-Control":"no-store"}}); }
  catch(e) { return generationError(e); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await generationUser(request);
    const body = await request.text(); if (body.length > 24000) throw Error("INVALID_INPUT");
    const id = await createSeedream(user.openId, JSON.parse(body));
    after(async () => { try { await runSeedreamQueue(); } catch { /* Durable queue resumes via timer. */ } });
    return NextResponse.json({success:true,id});
  } catch(e) { return generationError(e); }
}
