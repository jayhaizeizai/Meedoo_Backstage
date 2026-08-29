import { createMediaUrl } from "./media-url";
import { query } from "./db";
import { getUploadPostConfig, parseProviderResponse, providerMessage, supportedPlatforms, uploadPostFetch, UploadPostPlatform } from "./upload-post";

type ApprovedUpload = { id: string; request_id: string; title: string; caption: string; original_filename: string; media_path: string | null; target_platforms: string[]; review_status: string };

export async function publishApprovedUpload(uploadId: string) {
  const result = await query<ApprovedUpload>(`SELECT id::text,request_id,title,caption,original_filename,media_path,target_platforms,review_status FROM uploads WHERE id=$1`, [uploadId]);
  const upload = result.rows[0];
  if (!upload || upload.review_status !== "approved") throw new Error("UPLOAD_NOT_APPROVED");
  if (!upload.media_path) throw new Error("MEDIA_UNAVAILABLE");
  const platforms = upload.target_platforms.filter((item): item is UploadPostPlatform => supportedPlatforms.includes(item as UploadPostPlatform));
  const { profile } = getUploadPostConfig();
  const socialText = [upload.title,upload.caption].filter(Boolean).join("\n\n");
  const form = new FormData();
  form.append("video",createMediaUrl(upload.id,upload.original_filename)); form.append("title",upload.title); form.append("description",upload.caption);
  form.append("user",profile); form.append("async_upload","true"); form.append("request_id",upload.request_id); form.append("external_id",upload.id);
  for (const platform of platforms) form.append("platform[]",platform);
  if(platforms.includes("tiktok")){form.append("tiktok_title",socialText);form.append("post_mode","DIRECT_POST");form.append("disable_inbox_fallback","true");}
  if(platforms.includes("instagram"))form.append("instagram_title",socialText);
  if(platforms.includes("youtube")){form.append("youtube_title",upload.title.slice(0,100));form.append("youtube_description",upload.caption.slice(0,5000));}
  await query(`UPDATE uploads SET status='publishing',provider_error=NULL,updated_at=now() WHERE id=$1`,[upload.id]);
  await query(`UPDATE upload_sessions SET status='publishing',updated_at=now() WHERE id=$1`,[upload.id]);
  try {
    const response=await uploadPostFetch("/api/upload",{method:"POST",body:form}); const payload=await parseProviderResponse(response);
    if(!response.ok||payload.success===false){const message=providerMessage(payload,"Upload-Post rejected the approved video.");await query(`UPDATE uploads SET status='failed',provider_error=$2,completed_at=now(),updated_at=now() WHERE id=$1`,[upload.id,message]);await query(`UPDATE publications SET status='failed',success=false,error_message=$2,updated_at=now() WHERE upload_id=$1`,[upload.id,message]);throw new Error(message);}
    const requestId=typeof payload.request_id==="string"?payload.request_id:upload.request_id; const jobId=typeof payload.job_id==="string"?payload.job_id:null; const status=typeof payload.status==="string"?payload.status:"queued";
    await query(`UPDATE uploads SET request_id=$2,provider_job_id=$3,status=$4,updated_at=now() WHERE id=$1`,[upload.id,requestId,jobId,status]);
    await query(`UPDATE publications SET request_id=$2,provider_job_id=COALESCE($3,provider_job_id),status=$4,updated_at=now() WHERE upload_id=$1`,[upload.id,requestId,jobId,status]);
    await query(`UPDATE upload_sessions SET status='consumed',updated_at=now() WHERE id=$1`,[upload.id]);
    return {requestId,jobId,status};
  } catch (error) {
    if(error instanceof Error && !["UPLOAD_NOT_APPROVED","MEDIA_UNAVAILABLE"].includes(error.message)) await query(`UPDATE upload_sessions SET status='submitted',updated_at=now() WHERE id=$1`,[upload.id]);
    throw error;
  }
}
