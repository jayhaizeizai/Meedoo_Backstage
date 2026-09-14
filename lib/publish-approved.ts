import { assertFacebookDestination } from "./facebook-destination";
import { expireDashboardCache } from "./dashboard-cache";
import { createMediaUrl } from "./media-url";
import { query } from "./db";
import {
  getUploadPostConfig,
  parseProviderResponse,
  providerMessage,
  supportedPlatforms,
  uploadPostFetch,
  UploadPostPlatform,
} from "./upload-post";
import { appendSocialPublishFields } from "./social-publish-fields";
import { contentForPlatform } from "./platform-content";

type ApprovedUpload = {
  facebook_page_id: string | null;
  id: string;
  request_id: string;
  title: string;
  caption: string;
  platform_content: unknown;
  original_filename: string;
  media_path: string | null;
  target_platforms: string[];
  review_status: string;
};

export async function publishApprovedUpload(uploadId: string) {
  const result = await query<ApprovedUpload>(
    `SELECT id::text,request_id,title,caption,platform_content,original_filename,media_path,target_platforms,review_status,facebook_page_id FROM uploads WHERE id=$1 AND removed_at IS NULL`,
    [uploadId],
  );
  const upload = result.rows[0];
  if (!upload || upload.review_status !== "approved")
    throw new Error("UPLOAD_NOT_APPROVED");
  if (!upload.media_path) throw new Error("MEDIA_UNAVAILABLE");
  const platforms = upload.target_platforms.filter(
    (item): item is UploadPostPlatform =>
      supportedPlatforms.includes(item as UploadPostPlatform),
  );
  const { profile } = getUploadPostConfig();
  const youtube = contentForPlatform(
    upload.platform_content,
    "youtube",
    upload.title,
    upload.caption,
  );
  const form = new FormData();
  form.append("video", createMediaUrl(upload.id, upload.original_filename));
  form.append("title", youtube.title);
  form.append("description", youtube.caption);
  form.append("user", profile);
  form.append("async_upload", "true");
  form.append("request_id", upload.request_id);
  form.append("external_id", upload.id);
  for (const platform of platforms) form.append("platform[]", platform);
  if (platforms.includes("facebook"))
    await assertFacebookDestination(upload.facebook_page_id);
  appendSocialPublishFields(
    form,
    platforms,
    upload.platform_content,
    upload.title,
    upload.caption,
    upload.facebook_page_id,
  );
  await query(
    `UPDATE uploads SET status='publishing',provider_error=NULL,updated_at=now() WHERE id=$1`,
    [upload.id],
  );
  await query(
    `UPDATE upload_sessions SET status='publishing',updated_at=now() WHERE id=$1`,
    [upload.id],
  );
  try {
    const response = await uploadPostFetch("/api/upload", {
      method: "POST",
      body: form,
    });
    const payload = await parseProviderResponse(response);
    if (!response.ok || payload.success === false) {
      const message = providerMessage(
        payload,
        "Upload-Post rejected the approved video.",
      );
      await query(
        `UPDATE uploads SET status='failed',provider_error=$2,completed_at=now(),updated_at=now() WHERE id=$1`,
        [upload.id, message],
      );
      await query(
        `UPDATE publications SET status='failed',success=false,error_message=$2,updated_at=now() WHERE upload_id=$1`,
        [upload.id, message],
      );
      throw new Error(message);
    }
    const requestId =
      typeof payload.request_id === "string"
        ? payload.request_id
        : upload.request_id;
    const jobId = typeof payload.job_id === "string" ? payload.job_id : null;
    const status =
      typeof payload.status === "string" ? payload.status : "queued";
    await query(
      `UPDATE uploads SET request_id=$2,provider_job_id=$3,status=$4,updated_at=now() WHERE id=$1`,
      [upload.id, requestId, jobId, status],
    );
    await query(
      `UPDATE publications SET request_id=$2,provider_job_id=COALESCE($3,provider_job_id),status=$4,updated_at=now() WHERE upload_id=$1`,
      [upload.id, requestId, jobId, status],
    );
    await query(
      `UPDATE upload_sessions SET status='consumed',updated_at=now() WHERE id=$1`,
      [upload.id],
    );
    await expireDashboardCache();
    return { requestId, jobId, status };
  } catch (error) {
    if (
      error instanceof Error &&
      !["UPLOAD_NOT_APPROVED", "MEDIA_UNAVAILABLE"].includes(error.message)
    )
      await query(
        `UPDATE upload_sessions SET status='submitted',updated_at=now() WHERE id=$1`,
        [upload.id],
      );
    await expireDashboardCache();
    throw error;
  }
}
