import { NextRequest,NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../../lib/server-auth";
import { getOwnedUploadSession,saveChunk } from "../../../../../../lib/upload-staging";

type Context={params:Promise<{id:string;index:string}>};
export async function PUT(request:NextRequest,{params}:Context){
  const user=await getCurrentUser();if(!user)return NextResponse.json({success:false,message:"Authentication required."},{status:401});
  const {id,index:indexValue}=await params;const index=Number(indexValue);const session=await getOwnedUploadSession(id,user.openId);
  if(!session)return NextResponse.json({success:false,message:"Upload session not found."},{status:404});
  if(session.status!=="uploading"||new Date(session.expires_at).getTime()<Date.now())return NextResponse.json({success:false,message:"Upload session is no longer writable."},{status:409});
  if(!Number.isInteger(index)||index<0||index>=session.total_chunks)return NextResponse.json({success:false,message:"Invalid chunk index."},{status:400});
  const expected=index===session.total_chunks-1?Number(session.expected_size)-index*session.chunk_size:session.chunk_size;
  const contentLength=Number(request.headers.get("content-length")??0);if(contentLength!==expected)return NextResponse.json({success:false,message:"Invalid chunk size."},{status:400});
  try{const bytes=new Uint8Array(await request.arrayBuffer());await saveChunk(session,index,bytes);return NextResponse.json({success:true,index,size:bytes.byteLength});}
  catch(error){console.error("Chunk upload failed",{id,index,error:error instanceof Error?error.message:"unknown"});return NextResponse.json({success:false,message:"Could not save this chunk."},{status:500});}
}
