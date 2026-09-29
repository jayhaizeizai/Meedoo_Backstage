import {NextRequest,NextResponse} from "next/server";
import {generationUser,generationError} from "../../../../../lib/generation-http";
import {restoreFailedGeneration} from "../../../../../lib/generation-restore";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}) {try{const user=await generationUser(request);return NextResponse.json(await restoreFailedGeneration(user.openId,(await params).id),{headers:{"Cache-Control":"no-store"}});}catch(e){return generationError(e);}}
