import { isVideoType, type VideoType } from "./video-type";
import { assertFacebookDestination } from "./facebook-destination";
import { invalidateDashboardCache } from "./dashboard-cache";
import { stat } from "node:fs/promises";
import { uploadTitle } from "./upload-title";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { MeeDooUser } from "./auth";
import {
  getUploadPostConfig,
  supportedPlatforms,
  UploadPostPlatform,
} from "./upload-post";
import { UploadSession } from "./upload-staging";
import { isVerticalNineSixteen, probeVideo } from "./video-probe";
import { PlatformContent, validatePlatformContent } from "./platform-content";

export async function getUserRole(openId: string) {
  const result = await query<{ role: string }>(
    `SELECT role FROM meedoo_users WHERE open_id=$1`,
    [openId],
  );
  return result.rows[0]?.role ?? "member";
}

export async function isApprover(openId: string) {
  return (await getUserRole(openId)) === "approver";
}

export async function submitForReview(input: {
  videoType: VideoType;
  session: UploadSession;
  user: MeeDooUser;
  platformContent: PlatformContent;
  platforms: UploadPostPlatform[];
}) {
  if (!isVideoType(input.videoType)) throw new Error("VIDEO_TYPE_REQUIRED");
  const { profile, facebookPageId } = getUploadPostConfig();
  if (input.platforms.includes("facebook") && !facebookPageId)
    throw new Error("FACEBOOK_PAGE_REQUIRED");
  const probe = await probeVideo(input.session.media_path!);
  if (
    probe.width &&
    probe.height &&
    !isVerticalNineSixteen(probe.width, probe.height)
  )
    throw new Error("INVALID_ASPECT_RATIO");
  if (
    input.platforms.includes("facebook") &&
    (!probe.duration ||
      probe.duration < 3 ||
      probe.duration > 90 ||
      !probe.width ||
      probe.width < 540 ||
      !probe.height ||
      probe.height < 960)
  )
    throw new Error("FACEBOOK_REELS_VIDEO_REQUIREMENTS");
  if (
    input.platforms.includes("x") &&
    (!probe.duration || probe.duration > 1200)
  )
    throw new Error("X_VIDEO_DURATION_LIMIT");
  const display = input.platformContent.youtube;
  if (input.platforms.includes("threads") && (!probe.duration || probe.duration > 300))
    throw new Error("THREADS_VIDEO_DURATION_LIMIT");
  await transaction(async (client) => {
    const transitioned = await client.query(
      `UPDATE upload_sessions SET status='submitted',expires_at=now()+interval '60 days',updated_at=now()
      WHERE id=$1 AND status='ready' RETURNING id`,
      [input.session.id],
    );
    if (!transitioned.rowCount) throw new Error("UPLOAD_SESSION_NOT_READY");
    await client.query(
      `INSERT INTO uploads(id,profile_username,title,caption,platform_content,original_filename,media_size_bytes,media_path,uploader_open_id,uploader_name,status,target_platforms,review_status,submitted_at,video_width,video_height,video_duration_seconds,video_codec,video_type)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,'pending_review',$11,'pending',now(),$12,$13,$14,$15,$16)`,
      [
        input.session.id,
        profile || "pending",
        uploadTitle({
          platform_content: input.platformContent,
          original_filename: input.session.original_filename,
        }),
        display.caption,
        JSON.stringify(input.platformContent),
        input.session.original_filename,
        Number(input.session.expected_size),
        input.session.media_path,
        input.user.openId,
        input.user.name,
        input.platforms,
        probe.width,
        probe.height,
        probe.duration,
        probe.codec,
        input.videoType,
      ],
    );
    if (input.platforms.includes("facebook"))
      await client.query("UPDATE uploads SET facebook_page_id=$2 WHERE id=$1", [
        input.session.id,
        facebookPageId,
      ]);
  });
  return input.session.id;
}

export type ReviewRecord = {
  video_type: VideoType | null;
  facebook_page_id: string | null;
  id: string;
  title: string;
  caption: string;
  uploader_open_id: string | null;
  uploader_name: string | null;
  status: string;
  review_status: string;
  review_comment: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  target_platforms: string[];
  original_filename: string | null;
  media_size_bytes: string | null;
  media_path: string | null;
  reviewer_name: string | null;
  version: number;
  video_width: number | null;
  video_height: number | null;
  video_duration_seconds: string | null;
  video_codec: string | null;
  platform_content: PlatformContent | Record<string, never>;
  published_platforms: string[];
  file_deleted_at: string | null;
  media_available?: boolean;
};

export async function listReviewRecords(user: MeeDooUser, pendingOnly = false) {
  const approver = await isApprover(user.openId);
  const conditions = [
    "u.removed_at IS NULL",
    "($1::boolean OR u.uploader_open_id=$2)",
    pendingOnly ? "u.review_status='pending'" : "true",
  ];
  const result = await query<ReviewRecord>(
    `SELECT u.id::text,u.title,u.caption,u.video_type,u.uploader_open_id,COALESCE(NULLIF(u.uploader_name,''),owner.name) uploader_name,u.status,u.review_status,u.review_comment,
      u.submitted_at,u.reviewed_at,u.created_at,u.target_platforms,u.file_deleted_at,u.original_filename,u.media_size_bytes,u.media_path,u.version,u.video_width,u.video_height,u.video_duration_seconds,u.video_codec,u.platform_content,r.name reviewer_name,
      ARRAY(SELECT p.platform FROM publications p WHERE p.upload_id=u.id AND p.status='completed' AND p.removed_at IS NULL ORDER BY p.platform) published_platforms
    FROM uploads u LEFT JOIN meedoo_users owner ON owner.open_id=u.uploader_open_id LEFT JOIN meedoo_users r ON r.open_id=u.reviewed_by WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(u.submitted_at,u.created_at) DESC LIMIT 200`,
    [approver, user.openId],
  );
  const records = await Promise.all(
    result.rows.map(async (record) => ({
      ...record,
      title: uploadTitle(record),
      media_available: Boolean(
        !record.file_deleted_at &&
          record.media_path &&
          (await stat(record.media_path)
            .then((info) => info.isFile())
            .catch(() => false)),
      ),
    })),
  );
  return { approver, records };
}

export async function getReviewRecord(id: string, user: MeeDooUser) {
  const approver = await isApprover(user.openId);
  const result = await query<ReviewRecord>(
    `SELECT u.id::text,u.title,u.caption,u.video_type,u.uploader_open_id,COALESCE(NULLIF(u.uploader_name,''),owner.name) uploader_name,u.status,u.review_status,u.review_comment,
      u.submitted_at,u.reviewed_at,u.created_at,u.target_platforms,u.file_deleted_at,u.original_filename,u.media_size_bytes,u.media_path,u.version,u.video_width,u.video_height,u.video_duration_seconds,u.video_codec,u.platform_content,r.name reviewer_name,
      ARRAY(SELECT p.platform FROM publications p WHERE p.upload_id=u.id AND p.status='completed' AND p.removed_at IS NULL ORDER BY p.platform) published_platforms
    FROM uploads u LEFT JOIN meedoo_users owner ON owner.open_id=u.uploader_open_id LEFT JOIN meedoo_users r ON r.open_id=u.reviewed_by WHERE u.id=$1 AND u.removed_at IS NULL AND ($2::boolean OR u.uploader_open_id=$3)`,
    [id, approver, user.openId],
  );
  const history = result.rows[0]
    ? await query<{
        decision: string;
        comment: string | null;
        created_at: string;
        reviewer_name: string;
      }>(
        `SELECT ur.decision,ur.comment,ur.created_at,mu.name reviewer_name FROM upload_reviews ur JOIN meedoo_users mu ON mu.open_id=ur.reviewer_open_id WHERE ur.upload_id=$1 ORDER BY ur.created_at DESC`,
        [id],
      )
    : { rows: [] };
  return {
    approver,
    record: result.rows[0]
      ? { ...result.rows[0], title: uploadTitle(result.rows[0]) }
      : null,
    history: history.rows,
  };
}

export async function decideReview(
  id: string,
  reviewer: MeeDooUser,
  decision: "approved" | "rejected",
  comment: string,
  platformContent?: PlatformContent,
) {
  if (!(await isApprover(reviewer.openId)))
    throw new Error("APPROVER_REQUIRED");
  return transaction(async (client) => {
    const locked = await client.query<ReviewRecord>(
      `SELECT * FROM uploads WHERE id=$1 AND removed_at IS NULL FOR UPDATE`,
      [id],
    );
    const upload = locked.rows[0];
    if (!upload || upload.review_status !== "pending")
      throw new Error("REVIEW_NOT_PENDING");
    if (decision === "approved" && upload.target_platforms.includes("facebook"))
      await assertFacebookDestination(upload.facebook_page_id);
    if (decision === "rejected" && !comment.trim())
      throw new Error("COMMENT_REQUIRED");
    if (platformContent) {
      const invalid = validatePlatformContent(
        platformContent,
        upload.target_platforms,
      );
      if (invalid) throw new Error(invalid);
      const display = platformContent.youtube;
      await client.query(
        `UPDATE uploads SET title=$2,caption=$3,platform_content=$4::jsonb,updated_at=now() WHERE id=$1`,
        [
          id,
          uploadTitle({
            platform_content: platformContent,
            original_filename: upload.original_filename,
          }),
          display.caption,
          JSON.stringify(platformContent),
        ],
      );
    }
    await client.query(
      `UPDATE uploads SET review_status=$2,reviewed_by=$3,reviewed_at=now(),review_comment=$4,status=$5,media_delete_after=NULL,updated_at=now() WHERE id=$1`,
      [
        id,
        decision,
        reviewer.openId,
        comment.trim() || null,
        decision === "approved" ? "approved" : "rejected",
      ],
    );
    await client.query(
      `INSERT INTO upload_reviews(upload_id,reviewer_open_id,decision,comment) VALUES($1,$2,$3,$4)`,
      [id, reviewer.openId, decision, comment.trim() || null],
    );
    if (decision === "approved") {
      const requestId = randomUUID();
      const selected = (upload.target_platforms ?? []).filter(
        (item): item is UploadPostPlatform =>
          supportedPlatforms.includes(item as UploadPostPlatform),
      );
      await client.query(`UPDATE uploads SET request_id=$2 WHERE id=$1`, [
        id,
        requestId,
      ]);
      for (const platform of selected)
        await client.query(
          `INSERT INTO publications(upload_id,platform,request_id,status) VALUES($1,$2,$3,'queued') ON CONFLICT(upload_id,platform) DO NOTHING`,
          [id, platform, requestId],
        );
    }
    await invalidateDashboardCache(client);
    return { upload, decision };
  });
}

export async function updateReviewContent(
  id: string,
  reviewer: MeeDooUser,
  platformContent: PlatformContent,
) {
  if (!(await isApprover(reviewer.openId)))
    throw new Error("APPROVER_REQUIRED");
  return transaction(async (client) => {
    const locked = await client.query<ReviewRecord>(
      `SELECT * FROM uploads WHERE id=$1 AND removed_at IS NULL FOR UPDATE`,
      [id],
    );
    const upload = locked.rows[0];
    if (!upload || upload.review_status !== "pending")
      throw new Error("REVIEW_NOT_PENDING");
    const invalid = validatePlatformContent(
      platformContent,
      upload.target_platforms,
    );
    if (invalid) throw new Error(invalid);
    const display = platformContent.youtube;
    await client.query(
      `UPDATE uploads SET title=$2,caption=$3,platform_content=$4::jsonb,updated_at=now() WHERE id=$1`,
      [
        id,
        uploadTitle({
          platform_content: platformContent,
          original_filename: upload.original_filename,
        }),
        display.caption,
        JSON.stringify(platformContent),
      ],
    );
    return platformContent;
  });
}
