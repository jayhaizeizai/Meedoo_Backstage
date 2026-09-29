import {NextRequest,NextResponse} from "next/server";
import {generationUser,generationError} from "../../../../../lib/generation-http";
import {resolveGenerationAssets} from "../../../../../lib/generation-restore";
export async function POST(request:NextRequest) {try{const user=await generationUser(request);const raw=await request.text();if(raw.length>3000)throw Error("INVALID_INPUT");return NextResponse.json({assets:await resolveGenerationAssets(user.openId,JSON.parse(raw).ids)});}catch(e){return generationError(e);}}
