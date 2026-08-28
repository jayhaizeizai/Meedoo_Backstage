import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { createUpload, removeRejectedUpload, saveVideo, updateAcceptedUpload } from "../../../../lib/records";
import { getUploadPostConfig, isUploadPostConfigured, parseProviderResponse, providerMessage, supportedPlatforms, uploadPostFetch, UploadPostPlatform } from "../../../../lib/upload-post";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const acceptedTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function error(message: string, status: number, code: string) {
  return NextResponse.json({ success: false, message, code }, { status });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return error("Sign in with Lark before publishing.", 401, "AUTH_REQUIRED");
  if (!isUploadPostConfigured()) return error("Upload-Post is not configured on the server yet.", 503, "UPLOAD_POST_NOT_CONFIGURED");

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_VIDEO_BYTES + 1024 * 1024) return error("Video exceeds the 300 MB limit.", 413, "VIDEO_TOO_LARGE");

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return error("Could not read the upload.", 400, "INVALID_FORM_DATA");
  }

  const video = incoming.get("video");
  const title = String(incoming.get("title") ?? "").trim();
  const caption = String(incoming.get("caption") ?? "").trim();
  let requestedPlatforms: string[] = [];
  try {
    requestedPlatforms = JSON.parse(String(incoming.get("platforms") ?? "[]")) as string[];
  } catch {
    return error("Invalid platform selection.", 400, "INVALID_PLATFORMS");
  }

  const platforms = [...new Set(requestedPlatforms)].filter((item): item is UploadPostPlatform => supportedPlatforms.includes(item as UploadPostPlatform));
  if (!(video instanceof File) || video.size === 0) return error("Choose a video file.", 400, "VIDEO_REQUIRED");
  if (video.size > MAX_VIDEO_BYTES) return error("Video exceeds the 300 MB limit.", 413, "VIDEO_TOO_LARGE");
  if (!acceptedTypes.has(video.type) && !/\.(mp4|mov|webm)$/i.test(video.name)) return error("Use an MP4, MOV, or WebM video.", 415, "VIDEO_TYPE_NOT_SUPPORTED");
  if (!title || title.length > 100) return error("Title must contain 1–100 characters.", 400, "INVALID_TITLE");
  if (/[<>]/.test(title) || /[<>]/.test(caption)) return error("Title and caption cannot contain < or >.", 400, "INVALID_TEXT_CHARACTERS");
  const socialText = [title, caption].filter(Boolean).join("\n\n");
  if (socialText.length > 2200) return error("Title and caption together must be 2,200 characters or fewer.", 400, "INVALID_SOCIAL_TEXT");
  if (Buffer.byteLength(caption, "utf8") > 5000) return error("Caption must be 5,000 UTF-8 bytes or fewer.", 400, "INVALID_CAPTION");
  if (!platforms.length) return error("Select at least one publishing platform.", 400, "PLATFORM_REQUIRED");

  const requestId = randomUUID();
  const uploadId = randomUUID();
  const { profile } = getUploadPostConfig();
  let mediaPath: string | null = null;
  try {
    mediaPath = await saveVideo(uploadId, video);
    await createUpload({ id: uploadId, requestId, profile, title, caption, filename: video.name, size: video.size, mediaPath, user, platforms });
  } catch {
    return error("Could not save the publishing record.", 503, "DATABASE_UNAVAILABLE");
  }
  const providerForm = new FormData();
  providerForm.append("video", video, video.name || "video.mp4");
  providerForm.append("title", title);
  providerForm.append("description", caption);
  providerForm.append("user", profile);
  providerForm.append("async_upload", "true");
  providerForm.append("request_id", requestId);
  providerForm.append("external_id", requestId);
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
