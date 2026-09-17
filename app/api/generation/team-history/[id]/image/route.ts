import {NextRequest} from "next/server";
import {readFile} from "node:fs/promises";
import {generationUser,generationError} from "../../../../../../lib/generation-http";
import {teamGenerationImage} from "../../../../../../lib/generation-history";
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await generationUser(request),row=await teamGenerationImage(user.openId,(await params).id);
 return new Response(await readFile(row.path),{headers:{"Content-Type":row.mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",...(request.nextUrl.searchParams.get("download")==="1"?{"Content-Disposition":`attachment; filename="image-${row.id}.${row.mime==='image/png'?'png':row.mime==='image/webp'?'webp':'jpg'}"`}:{})}});
}catch(e){return generationError(e);}}
