import { NextRequest,NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { acceptedVideoTypes,createUploadSession,MAX_VIDEO_BYTES } from "../../../../lib/upload-staging";

export async function POST(request:NextRequest){
  const user=await getCurrentUser(); if(!user)return NextResponse.json({success:false,message:"Authentication required."},{status:401});
  const body=await request.json().catch(()=>({})) as {filename?:string;contentType?:string;size?:number};
  const filename=String(body.filename??"").trim(); const contentType=String(body.contentType??"").toLowerCase(); const size=Number(body.size);
  if(!filename||filename.length>255)return NextResponse.json({success:false,message:"Invalid filename."},{status:400});
  if(!Number.isInteger(size)||size<=0||size>MAX_VIDEO_BYTES)return NextResponse.json({success:false,message:"Video must be 1.5 GB or smaller."},{status:413});
  if(!acceptedVideoTypes.has(contentType)&&!/\.(mp4|mov|webm)$/i.test(filename))return NextResponse.json({success:false,message:"Use an MP4, MOV, or WebM video."},{status:415});
  try{return NextResponse.json({success:true,...await createUploadSession(user,{filename,contentType:contentType||"video/mp4",size})});}
  catch(error){const code=error instanceof Error?error.message:"unknown";console.error("Upload session initialization failed",code);if(code==="TOO_MANY_UPLOAD_SESSIONS")return NextResponse.json({success:false,message:"Finish or cancel an existing upload before starting another."},{status:429});if(code==="INSUFFICIENT_STORAGE")return NextResponse.json({success:false,message:"Temporary storage does not have enough free space."},{status:507});return NextResponse.json({success:false,message:"Could not initialize temporary storage."},{status:503});}
}
