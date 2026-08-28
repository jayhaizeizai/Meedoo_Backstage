import { NextRequest,NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/server-auth";
import { assembleUploadSession,getOwnedUploadSession } from "../../../../../lib/upload-staging";

type Context={params:Promise<{id:string}>};
export async function POST(_request:NextRequest,{params}:Context){
  const user=await getCurrentUser();if(!user)return NextResponse.json({success:false,message:"Authentication required."},{status:401});const {id}=await params;
  const session=await getOwnedUploadSession(id,user.openId);if(!session)return NextResponse.json({success:false,message:"Upload session not found."},{status:404});
  if(session.status==="ready")return NextResponse.json({success:true,id,status:"ready"});
  if(session.status!=="uploading")return NextResponse.json({success:false,message:"Upload session cannot be completed."},{status:409});
  try{await assembleUploadSession(session);return NextResponse.json({success:true,id,status:"ready"});}
  catch(error){const code=error instanceof Error?error.message:"ASSEMBLY_FAILED";return NextResponse.json({success:false,message:code==="MISSING_CHUNKS"?"Some video chunks are missing.":"Could not assemble the video."},{status:code==="MISSING_CHUNKS"?409:500});}
}
