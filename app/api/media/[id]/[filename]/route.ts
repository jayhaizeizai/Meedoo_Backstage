import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest,NextResponse } from "next/server";
import { verifyMediaUrl } from "../../../../../lib/media-url";
import { getReadyUploadSession } from "../../../../../lib/upload-staging";

export const runtime="nodejs";
type Context={params:Promise<{id:string;filename:string}>};

async function serve(request:NextRequest,{params}:Context,head=false){
  const {id}=await params;if(!verifyMediaUrl(id,request.nextUrl.searchParams.get("expires"),request.nextUrl.searchParams.get("signature")))return NextResponse.json({success:false,message:"Link expired or invalid."},{status:403});
  const session=await getReadyUploadSession(id);if(!session?.media_path||!["ready","publishing","consumed"].includes(session.status))return NextResponse.json({success:false,message:"Media unavailable."},{status:404});
  const info=await stat(session.media_path).catch(()=>null);if(!info)return NextResponse.json({success:false,message:"Media unavailable."},{status:404});
  let start=0,end=info.size-1,status=200;const range=request.headers.get("range");
  if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${info.size}`}});if(!match[1]){const suffix=Number(match[2]);if(!Number.isInteger(suffix)||suffix<=0)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${info.size}`}});start=Math.max(0,info.size-suffix);end=info.size-1;}else{start=Number(match[1]);end=match[2]?Number(match[2]):info.size-1;}if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>=info.size)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${info.size}`}});status=206;}
  const headers=new Headers({"Content-Type":session.content_type||"video/mp4","Content-Length":String(end-start+1),"Accept-Ranges":"bytes","Cache-Control":"private, no-store"});if(status===206)headers.set("Content-Range",`bytes ${start}-${end}/${info.size}`);
  if(head)return new Response(null,{status,headers});
  const stream=Readable.toWeb(createReadStream(session.media_path,{start,end})) as ReadableStream<Uint8Array>;
  return new Response(stream,{status,headers});
}
export async function GET(request:NextRequest,context:Context){return serve(request,context);}
export async function HEAD(request:NextRequest,context:Context){return serve(request,context,true);}
