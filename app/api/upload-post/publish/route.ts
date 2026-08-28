import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { createUpload, removeRejectedUpload, updateAcceptedUpload } from "../../../../lib/records";
import { query } from "../../../../lib/db";
import { createMediaUrl } from "../../../../lib/media-url";
import { getOwnedUploadSession } from "../../../../lib/upload-staging";
import { getUploadPostConfig, isUploadPostConfigured, parseProviderResponse, providerMessage, supportedPlatforms, uploadPostFetch, UploadPostPlatform } from "../../../../lib/upload-post";

export const runtime = "nodejs";
export const maxDuration = 300;

function error(message: string, status: number, code: string) {
  return NextResponse.json({ success: false, message, code }, { status });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error("Sign in with Lark before publishing.", 401, "AUTH_REQUIRED");
  if (!isUploadPostConfigured()) return error("Upload-Post is not configured on the server yet.", 503, "UPLOAD_POST_NOT_CONFIGURED");

  let incoming: { uploadSessionId?: string; title?: string; caption?: string; platforms?: string[] };
  try {
    incoming = await request.json() as typeof incoming;
  } catch {
    return error("Could not read the publishing request.", 400, "INVALID_JSON");
  }

  const uploadSessionId = String(incoming.uploadSessionId ?? "");
  const title = String(incoming.title ?? "").trim();
  const caption = String(incoming.caption ?? "").trim();
  const requestedPlatforms = Array.isArray(incoming.platforms) ? incoming.platforms : [];

  const platforms = [...new Set(requestedPlatforms)].filter((item): item is UploadPostPlatform => supportedPlatforms.includes(item as UploadPostPlatform));
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(uploadSessionId)) return error("Complete the temporary video upload first.", 400, "UPLOAD_SESSION_REQUIRED");
  const staged = await getOwnedUploadSession(uploadSessionId,user.openId);
  if (!staged?.media_path || staged.status !== "ready") return error("Temporary video is not ready or has already been used.", 409, "UPLOAD_SESSION_NOT_READY");
  if (!title || title.length > 100) return error("Title must contain 1–100 characters.", 400, "INVALID_TITLE");
  if (/[<>]/.test(title) || /[<>]/.test(caption)) return error("Title and caption cannot contain < or >.", 400, "INVALID_TEXT_CHARACTERS");
  const socialText = [title, caption].filter(Boolean).join("\n\n");
  if (socialText.length > 2200) return error("Title and caption together must be 2,200 characters or fewer.", 400, "INVALID_SOCIAL_TEXT");
  if (Buffer.byteLength(caption, "utf8") > 5000) return error("Caption must be 5,000 UTF-8 bytes or fewer.", 400, "INVALID_CAPTION");
  if (!platforms.length) return error("Select at least one publishing platform.", 400, "PLATFORM_REQUIRED");

  const requestId = randomUUID();
  const uploadId = uploadSessionId;
  const { profile } = getUploadPostConfig();
  try {
    await createUpload({ id: uploadId, requestId, profile, title, caption, filename: staged.original_filename, size: Number(staged.expected_size), mediaPath: staged.media_path, user, platforms });
    await query(`UPDATE upload_sessions SET status='publishing',updated_at=now() WHERE id=$1`,[uploadSessionId]);
  } catch {
    return error("Could not save the publishing record.", 503, "DATABASE_UNAVAILABLE");
  }
  const providerForm = new FormData();
  providerForm.append("video", createMediaUrl(uploadSessionId,staged.original_filename));
  providerForm.append("title", title);
  providerForm.append("description", caption);
  providerForm.append("user", profile);
  providerForm.append("async_upload", "true");
  providerForm.append("request_id", requestId);
  providerForm.append("external_id", uploadId);
  for (const platform of platforms) providerForm.append("platform[]", platform);

  if (platforms.includes("tiktok")) {
    providerForm.append("tiktok_title", socialText);
    providerForm.append("post_mode", "DIRECT_POST");
    providerForm.append("disable_inbox_fallback", "true");
  }
  if (platforms.includes("instagram")) providerForm.append("instagram_title", socialText);
  if (platforms.includes("youtube")) {
    providerForm.append("youtube_title", title.slice(0, 100));
    providerForm.append("youtube_description", caption.slice(0, 5000));
  }

  try {
    const providerResponse = await uploadPostFetch("/api/upload", { method: "POST", body: providerForm });
    const payload = await parseProviderResponse(providerResponse);
    if (!providerResponse.ok || payload.success === false) {
      const message = providerMessage(payload, "Upload-Post rejected the publishing request.");
      await removeRejectedUpload(uploadId, message);
      return error(message, providerResponse.status >= 400 ? providerResponse.status : 502, "UPLOAD_POST_REJECTED");
    }

    const acceptedRequestId = typeof payload.request_id === "string" ? payload.request_id : requestId;
    const jobId = typeof payload.job_id === "string" ? payload.job_id : null;
    const acceptedStatus = typeof payload.status === "string" ? payload.status : "queued";
    await updateAcceptedUpload(uploadId, acceptedRequestId, jobId, acceptedStatus);
    await query(`UPDATE upload_sessions SET status='consumed',updated_at=now() WHERE id=$1`,[uploadSessionId]);

    return NextResponse.json({
      success: true,
      uploadId,
      requestId: acceptedRequestId,
      jobId,
      status: acceptedStatus,
      totalPlatforms: platforms.length,
      platforms,
      uploader: { openId: user.openId, name: user.name },
      results: payload.results ?? null,
    }, { status: providerResponse.status === 202 ? 202 : 200 });
  } catch (cause) {
    const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    await removeRejectedUpload(uploadId, timedOut ? "Upload-Post timed out while accepting the video." : "Could not reach Upload-Post.");
    return error(timedOut ? "Upload-Post timed out while accepting the video." : "Could not reach Upload-Post.", 502, timedOut ? "UPLOAD_POST_TIMEOUT" : "UPLOAD_POST_UNAVAILABLE");
  }
}
