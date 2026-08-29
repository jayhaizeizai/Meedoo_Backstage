import { NextRequest,NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getOwnedUploadSession } from "../../../../lib/upload-staging";
import { supportedPlatforms,UploadPostPlatform } from "../../../../lib/upload-post";
import { submitForReview } from "../../../../lib/approvals";
import { notifyApprovers } from "../../../../lib/notifications";

export const runtime="nodejs";
function error(message:string,status:number,code:string){return NextResponse.json({success:false,message,code},{status});}

export async function POST(request:NextRequest){
  const user=await getCurrentUser();if(!user)return error("Sign in with Lark before submitting.",401,"AUTH_REQUIRED");
  const body=await request.json().catch(()=>({})) as {uploadSessionId?:string;title?:string;caption?:string;platforms?:string[]};
  const id=String(body.uploadSessionId??"");const title=String(body.title??"").trim();const caption=String(body.caption??"").trim();
  const platforms=[...new Set(Array.isArray(body.platforms)?body.platforms:[])].filter((item):item is UploadPostPlatform=>supportedPlatforms.includes(item as UploadPostPlatform));
  const staged=await getOwnedUploadSession(id,user.openId);if(!staged?.media_path||staged.status!=="ready")return error("Temporary video is not ready or has already been used.",409,"UPLOAD_SESSION_NOT_READY");
  if(!title||title.length>100)return error("Title must contain 1–100 characters.",400,"INVALID_TITLE");
  if(/[<>]/.test(title)||/[<>]/.test(caption))return error("Title and caption cannot contain < or >.",400,"INVALID_TEXT_CHARACTERS");
  if([title,caption].filter(Boolean).join("\n\n").length>2200)return error("Title and caption together must be 2,200 characters or fewer.",400,"INVALID_SOCIAL_TEXT");
  if(Buffer.byteLength(caption,"utf8")>5000)return error("Caption must be 5,000 UTF-8 bytes or fewer.",400,"INVALID_CAPTION");
  if(!platforms.length)return error("Select at least one publishing platform.",400,"PLATFORM_REQUIRED");
  try{const uploadId=await submitForReview({session:staged,user,title,caption,platforms});await notifyApprovers(uploadId,`MeeDoo: “${title}” was submitted by ${user.name} and is waiting for your review.\n${process.env.APP_URL}/approvals/${uploadId}`);return NextResponse.json({success:true,uploadId,requestId:uploadId,status:"pending_review"},{status:202});}
  catch(cause){const code=cause instanceof Error?cause.message:"unknown";console.error("Review submission failed",code);if(code==="INVALID_ASPECT_RATIO")return error("Video must use a vertical 9:16 aspect ratio.",400,code);return NextResponse.json({success:false,message:"Could not submit this video for review."},{status:503});}
}
