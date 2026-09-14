import { assertFacebookDestination } from "../../../../lib/facebook-destination";
import { updateUploadSummary } from "../../../../lib/publication-status";
import { expireDashboardCache } from "../../../../lib/dashboard-cache";
import { randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { query, transaction } from "../../../../lib/db";
import { createMediaUrl } from "../../../../lib/media-url";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getUploadPostConfig,parseProviderResponse,providerMessage,supportedPlatforms,uploadPostFetch,UploadPostPlatform } from "../../../../lib/upload-post";
import { appendSocialPublishFields } from "../../../../lib/social-publish-fields";
import { contentForPlatform } from "../../../../lib/platform-content";

export async function POST(request:NextRequest) {
  const user=await getCurrentUser();if(!user) return NextResponse.json({success:false,message:"Authentication required."},{status:401});
  const body=await request.json().catch(()=>({})) as {uploadId?:string;platform?:string};
  if(!body.uploadId||!supportedPlatforms.includes(body.platform as UploadPostPlatform)) return NextResponse.json({success:false,message:"Invalid retry request."},{status:400});
  const found=await query<{facebook_page_id:string|null;id:string;title:string;caption:string;platform_content:unknown;original_filename:string;media_path:string|null;platform:string;status:string}>(`SELECT u.facebook_page_id,u.id,u.title,u.caption,u.platform_content,u.original_filename,u.media_path,p.platform,p.status FROM uploads u JOIN publications p ON p.upload_id=u.id LEFT JOIN meedoo_users actor ON actor.open_id=$3 WHERE u.id=$1 AND u.removed_at IS NULL AND p.removed_at IS NULL AND p.platform=$2 AND (u.uploader_open_id=$3 OR actor.role='approver')`,[body.uploadId,body.platform,user.openId]);
  const item=found.rows[0];
  if(!item||item.status!=="failed") return NextResponse.json({success:false,message:"Only failed platform jobs can be retried."},{status:409});
  if(!item.media_path) return NextResponse.json({success:false,message:"The original video is unavailable; upload it again."},{status:410});
  const requestId=randomUUID(); const platform=item.platform as UploadPostPlatform; const {profile}=getUploadPostConfig();
  const content=contentForPlatform(item.platform_content,platform,item.title,item.caption);
  const form=new FormData(); form.append("video",createMediaUrl(item.id,item.original_filename)); form.append("title",content.title); form.append("description",content.caption); form.append("user",profile); form.append("async_upload","true"); form.append("request_id",requestId); form.append("external_id",item.id); form.append("platform[]",platform);
  if(platform === "facebook" && !item.facebook_page_id) return NextResponse.json({success:false,message:"Facebook Page is missing from this submission."},{status:409});
  if (platform === "facebook") {
    try { await assertFacebookDestination(item.facebook_page_id); }
    catch { return NextResponse.json({success:false,message:"Facebook Page configuration changed or is unavailable."},{status:409}); }
  }
  appendSocialPublishFields(form, [platform], item.platform_content, item.title, item.caption, item.facebook_page_id);
  const claimed=await transaction(async client=>{
    await client.query("SELECT id FROM uploads WHERE id=$1 FOR UPDATE",[item.id]);
    const result=await client.query(`UPDATE publications SET status='retrying',retry_count=retry_count+1,request_id=$3,
      provider_job_id=NULL,success=NULL,error_message=NULL,updated_at=now() WHERE upload_id=$1 AND platform=$2 AND status='failed'
      AND removed_at IS NULL AND EXISTS(SELECT 1 FROM uploads WHERE id=$1 AND removed_at IS NULL) RETURNING id`,[item.id,platform,requestId]);
    if(result.rowCount)await client.query("UPDATE uploads SET status='processing',completed_at=NULL,media_delete_after=NULL WHERE id=$1",[item.id]);
    return Boolean(result.rowCount);
  });
  if(!claimed)return NextResponse.json({success:false,message:"This platform already has an active retry."},{status:409});
  await expireDashboardCache();
  try {
    const response=await uploadPostFetch("/api/upload",{method:"POST",body:form});
    const payload=await parseProviderResponse(response);
    // Transport/5xx/invalid responses do not prove the provider rejected the upload.
    if(response.status>=500 || (response.ok && payload.success===false && payload.message==="Invalid provider response"))throw new Error("RETRY_OUTCOME_UNKNOWN");
    if(!response.ok || payload.success===false){
      const message=providerMessage(payload,"Retry was rejected.");
      await transaction(async client=>{
        await client.query("SELECT id FROM uploads WHERE id=$1 FOR UPDATE",[item.id]);
        await client.query(`UPDATE publications SET status='failed',success=false,error_message=$3,updated_at=now()
          WHERE upload_id=$1 AND platform=$2 AND request_id=$4 AND status IN ('retrying','reconciling')`,[item.id,platform,message,requestId]);
        await updateUploadSummary(client,item.id);
      });
      return NextResponse.json({success:false,message},{status:response.status>=400?response.status:502});
    }
    const accepted=typeof payload.request_id==="string"?payload.request_id:requestId;
    await query(`UPDATE publications SET request_id=$3,provider_job_id=COALESCE($4,provider_job_id),status='queued',updated_at=now()
      WHERE upload_id=$1 AND platform=$2 AND request_id=$5 AND status IN ('retrying','reconciling')`,
      [item.id,platform,accepted,typeof payload.job_id==="string"?payload.job_id:null,requestId]);
    await expireDashboardCache();
    return NextResponse.json({success:true,requestId:accepted,status:"queued"});
  } catch {
    await query(`UPDATE publications SET status='reconciling',error_message='Awaiting provider confirmation; do not resubmit.',updated_at=now()
      WHERE upload_id=$1 AND platform=$2 AND request_id=$3 AND status='retrying'`,[item.id,platform,requestId]);
    await expireDashboardCache();
    return NextResponse.json({success:true,requestId,status:"reconciling",message:"Awaiting provider confirmation."},{status:202});
  }
}
