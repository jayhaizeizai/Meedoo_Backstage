import { after, NextRequest, NextResponse } from "next/server";
import { generationUser } from "../../../../../../../../lib/generation-http";
import { assignmentBody, assignmentError } from "../../../../../../../../lib/assignments/http";
import { generateForAssignment } from "../../../../../../../../lib/assignments/data";
import { shotAccess, shotAssets, shotHistory, shotVideo } from "../../../../../../../../lib/assignments/shot-studio";
import { refreshGeneration } from "../../../../../../../../lib/generation";
import { runSeedreamQueue } from "../../../../../../../../lib/seedream";
import { GET as media } from "../../../../media/[asset]/route";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=600;
type Context={params:Promise<{id:string;shot:string;operation?:string[]}>};
const json=(value:unknown)=>NextResponse.json(value,{headers:{"Cache-Control":"no-store"}});
export async function GET(request:NextRequest,context:Context){try{
  const user=await generationUser(request),{id,shot,operation=[]}=await context.params;
  await shotAccess(user.openId,id,shot);
  if(!operation.length||operation.join('/')==='images')return json(await shotHistory(user.openId,id,shot,request.nextUrl.searchParams.get('page')??1,operation[0]==='images'));
  if(operation.length===2&&operation[1]==='media'){
    await shotVideo(id,shot,operation[0]);const url=new URL(request.url);url.searchParams.set('type','video');
    return media(new NextRequest(url,{headers:request.headers}),{params:Promise.resolve({id,asset:operation[0]})});
  }
  throw Error('NOT_FOUND');
}catch(e){return assignmentError(e);}}
export async function POST(request:NextRequest,context:Context){try{
  const user=await generationUser(request),{id,shot,operation=[]}=await context.params;
  await shotAccess(user.openId,id,shot,true);
  if(operation.join('/')==='assets/resolve')return json({assets:await shotAssets(user.openId,id,(await assignmentBody(request)).ids)});
  if(operation.length===2&&['restore','refresh'].includes(operation[1])){
    const task=await shotVideo(id,shot,operation[0]);
    if(operation[1]==='refresh'){await refreshGeneration(task.id,task.owner_id);return json({success:true});}
    if(task.status!=='failed')throw Error('NOT_FOUND');
    const found=await shotAssets(user.openId,id,task.input.assets.map((a:{id:string})=>a.id));
    const assets=task.input.assets.flatMap((a:{id:string;role:string})=>{const match=found.find(f=>f.sourceId===a.id);return match?[{...match,role:a.role}]:[];});
    return json({input:task.input,assets,missing:task.input.assets.length-assets.length});
  }
  if(!operation.length||operation.join('/')==='images'){
    const input=await assignmentBody(request),images=operation[0]==='images';
    const result=await generateForAssignment(user,id,{action:images?'storyboard':'video',shotId:shot,requestId:input.requestId,input});
    if(images)after(async()=>{try{await runSeedreamQueue();}catch{}});
    return json({success:true,id:result});
  }
  throw Error('NOT_FOUND');
}catch(e){return assignmentError(e);}}
