import { randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { createMediaUrl } from "../../../../lib/media-url";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getUploadPostConfig,parseProviderResponse,providerMessage,supportedPlatforms,uploadPostFetch,UploadPostPlatform } from "../../../../lib/upload-post";
import { contentForPlatform } from "../../../../lib/platform-content";

export async function POST(request:NextRequest) {
  const user=await getCurrentUser();if(!user) return NextResponse.json({success:false,message:"Authentication required."},{status:401});
  const body=await request.json().catch(()=>({})) as {uploadId?:string;platform?:string};
  if(!body.uploadId||!supportedPlatforms.includes(body.platform as UploadPostPlatform)) return NextResponse.json({success:false,message:"Invalid retry request."},{status:400});
  const found=await query<{id:string;title:string;caption:string;platform_content:unknown;original_filename:string;media_path:string|null;platform:string;status:string}>(`SELECT u.id,u.title,u.caption,u.platform_content,u.original_filename,u.media_path,p.platform,p.status FROM uploads u JOIN publications p ON p.upload_id=u.id LEFT JOIN meedoo_users actor ON actor.open_id=$3 WHERE u.id=$1 AND u.removed_at IS NULL AND p.removed_at IS NULL AND p.platform=$2 AND (u.uploader_open_id=$3 OR actor.role='approver')`,[body.uploadId,body.platform,user.openId]);
  const item=found.rows[0];
  if(!item||item.status!=="failed") return NextResponse.json({success:false,message:"Only failed platform jobs can be retried."},{status:409});
  if(!item.media_path) return NextResponse.json({success:false,message:"The original video is unavailable; upload it again."},{status:410});
  const requestId=randomUUID(); const platform=item.platform as UploadPostPlatform; const {profile}=getUploadPostConfig();
  const content=contentForPlatform(item.platform_content,platform,item.title,item.caption);
  const form=new FormData(); form.append("video",createMediaUrl(item.id,item.original_filename)); form.append("title",content.title); form.append("description",content.caption); form.append("user",profile); form.append("async_upload","true"); form.append("request_id",requestId); form.append("external_id",item.id); form.append("platform[]",platform);
  if(platform==="youtube"){form.append("youtube_title",content.title.slice(0,100));form.append("youtube_description",content.caption.slice(0,5000));}
  if(platform==="instagram") form.append("instagram_title",`${content.title}\n\n${content.caption}`);
  if(platform==="tiktok"){form.append("tiktok_title",`${content.title}\n\n${content.caption}`);form.append("post_mode","DIRECT_POST");form.append("disable_inbox_fallback","true");}
  await query(`UPDATE publications SET status='retrying',retry_count=retry_count+1,request_id=$3,error_message=NULL,updated_at=now() WHERE upload_id=$1 AND platform=$2`,[item.id,platform,requestId]);
  const response=await uploadPostFetch("/api/upload",{method:"POST",body:form}); const payload=await parseProviderResponse(response);
  if(!response.ok||payload.success===false){const message=providerMessage(payload,"Retry was rejected.");await query(`UPDATE publications SET status='failed',error_message=$3,updated_at=now() WHERE upload_id=$1 AND platform=$2`,[item.id,platform,message]);return NextResponse.json({success:false,message},{status:response.status>=400?response.status:502});}
  const accepted=typeof payload.request_id==="string"?payload.request_id:requestId; await query(`UPDATE publications SET request_id=$3,provider_job_id=$4,status=$5,updated_at=now() WHERE upload_id=$1 AND platform=$2`,[item.id,platform,accepted,typeof payload.job_id==="string"?payload.job_id:null,typeof payload.status==="string"?payload.status:"queued"]); await query(`UPDATE uploads SET status='processing',completed_at=NULL,updated_at=now() WHERE id=$1`,[item.id]);
  return NextResponse.json({success:true,requestId:accepted,status:typeof payload.status==="string"?payload.status:"queued"});
}
