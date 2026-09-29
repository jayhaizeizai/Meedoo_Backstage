import {NextRequest,NextResponse} from "next/server";
import {generationUser,generationError} from "../../../../lib/generation-http";
import {teamGenerationHistory} from "../../../../lib/generation-history";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){try{const user=await generationUser(request);return NextResponse.json(await teamGenerationHistory(user.openId,request.nextUrl.searchParams.get("page")??1,request.nextUrl.searchParams.get("kind")??"all"),{headers:{"Cache-Control":"no-store"}});}catch(e){return generationError(e);}}
