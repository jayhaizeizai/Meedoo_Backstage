import { NextRequest,NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getOwnedUploadSession } from "../../../../lib/upload-staging";
import { supportedPlatforms,UploadPostPlatform } from "../../../../lib/upload-post";
import { submitForReview } from "../../../../lib/approvals";
import { notifyApprovers } from "../../../../lib/notifications";
import { parsePlatformContent, validatePlatformContent } from "../../../../lib/platform-content";

export const runtime="nodejs";
function error(message:string,status:number,code:string){return NextResponse.json({success:false,message,code},{status});}

export async function POST(request:NextRequest){
  const user=await getCurrentUser();if(!user)return error("Sign in with Lark before submitting.",401,"AUTH_REQUIRED");
  const body=await request.json().catch(()=>({})) as {uploadSessionId?:string;platformContent?:unknown;platforms?:string[]};
  const id=String(body.uploadSessionId??"");const platformContent=parsePlatformContent(body.platformContent);
  const platforms=[...new Set(Array.isArray(body.platforms)?body.platforms:[])].filter((item):item is UploadPostPlatform=>supportedPlatforms.includes(item as UploadPostPlatform));
  const staged=await getOwnedUploadSession(id,user.openId);if(!staged?.media_path||staged.status!=="ready")return error("Temporary video is not ready or has already been used.",409,"UPLOAD_SESSION_NOT_READY");
  if(!platformContent)return error("A title and caption are required for all three platforms.",400,"PLATFORM_CONTENT_REQUIRED");
  const validationCode=validatePlatformContent(platformContent);if(validationCode)return error("Each platform requires a valid title and caption. Titles must be 1–100 characters; title and caption together must be at most 2,200 characters.",400,validationCode);
  if(platforms.length!==supportedPlatforms.length||supportedPlatforms.some((platform)=>!platforms.includes(platform)))return error("TikTok, Instagram, and YouTube must all be selected.",400,"ALL_PLATFORMS_REQUIRED");
  try{const uploadId=await submitForReview({session:staged,user,platformContent,platforms});const title=platformContent.youtube.title;await notifyApprovers(uploadId,`MeeDoo: “${title}” was submitted by ${user.name} and is waiting for your review.\n${process.env.APP_URL}/approvals/${uploadId}`);return NextResponse.json({success:true,uploadId,requestId:uploadId,status:"pending_review"},{status:202});}
  catch(cause){const code=cause instanceof Error?cause.message:"unknown";console.error("Review submission failed",code);if(code==="INVALID_ASPECT_RATIO")return error("Video must use a vertical 9:16 aspect ratio.",400,code);return NextResponse.json({success:false,message:"Could not submit this video for review."},{status:503});}
}
