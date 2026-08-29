import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { MeeDooUser } from "./auth";
import { getUploadPostConfig, supportedPlatforms, UploadPostPlatform } from "./upload-post";
import { UploadSession } from "./upload-staging";
import {isVerticalNineSixteen,probeVideo} from "./video-probe";

export async function getUserRole(openId: string) {
  const result = await query<{ role: string }>(`SELECT role FROM meedoo_users WHERE open_id=$1`, [openId]);
  return result.rows[0]?.role ?? "member";
}

export async function isApprover(openId: string) {
  return (await getUserRole(openId)) === "approver";
}

export async function submitForReview(input: { session: UploadSession; user: MeeDooUser; title: string; caption: string; platforms: UploadPostPlatform[] }) {
  const { profile } = getUploadPostConfig();
  const probe=await probeVideo(input.session.media_path!);if(probe.width&&probe.height&&!isVerticalNineSixteen(probe.width,probe.height))throw new Error("INVALID_ASPECT_RATIO");
  await transaction(async (client) => {
    await client.query(`INSERT INTO uploads(id,profile_username,title,caption,original_filename,media_size_bytes,media_path,uploader_open_id,uploader_name,status,target_platforms,review_status,submitted_at,video_width,video_height,video_duration_seconds,video_codec)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review',$10,'pending',now(),$11,$12,$13,$14)`,
    [input.session.id,profile || "pending",input.title,input.caption,input.session.original_filename,Number(input.session.expected_size),input.session.media_path,input.user.openId,input.user.name,input.platforms,probe.width,probe.height,probe.duration,probe.codec]);
    await client.query(`UPDATE upload_sessions SET status='submitted',expires_at=now()+interval '60 days',updated_at=now() WHERE id=$1 AND status='ready'`, [input.session.id]);
  });
  return input.session.id;
}

export type ReviewRecord = {
  id: string; title: string; caption: string; uploader_open_id: string | null; uploader_name: string | null; status: string;
  review_status: string; review_comment: string | null; submitted_at: string | null; reviewed_at: string | null; created_at: string;
  target_platforms: string[]; original_filename: string | null; media_size_bytes: string | null; media_path: string | null;
  reviewer_name: string | null; version: number;
  video_width:number|null;video_height:number|null;video_duration_seconds:string|null;video_codec:string|null;
};

export async function listReviewRecords(user: MeeDooUser, pendingOnly = false) {
  const approver = await isApprover(user.openId);
  const conditions = ["($1::boolean OR u.uploader_open_id=$2)", pendingOnly ? "u.review_status='pending'" : "true"];
  const result = await query<ReviewRecord>(`SELECT u.id::text,u.title,u.caption,u.uploader_open_id,u.uploader_name,u.status,u.review_status,u.review_comment,
      u.submitted_at,u.reviewed_at,u.created_at,u.target_platforms,u.original_filename,u.media_size_bytes,u.media_path,u.version,u.video_width,u.video_height,u.video_duration_seconds,u.video_codec,r.name reviewer_name
    FROM uploads u LEFT JOIN meedoo_users r ON r.open_id=u.reviewed_by WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(u.submitted_at,u.created_at) DESC LIMIT 200`, [approver,user.openId]);
  return { approver, records: result.rows };
}

export async function getReviewRecord(id: string, user: MeeDooUser) {
  const approver = await isApprover(user.openId);
  const result = await query<ReviewRecord>(`SELECT u.id::text,u.title,u.caption,u.uploader_open_id,u.uploader_name,u.status,u.review_status,u.review_comment,
      u.submitted_at,u.reviewed_at,u.created_at,u.target_platforms,u.original_filename,u.media_size_bytes,u.media_path,u.version,u.video_width,u.video_height,u.video_duration_seconds,u.video_codec,r.name reviewer_name
    FROM uploads u LEFT JOIN meedoo_users r ON r.open_id=u.reviewed_by WHERE u.id=$1 AND ($2::boolean OR u.uploader_open_id=$3)`, [id,approver,user.openId]);
  const history=result.rows[0]?await query<{decision:string;comment:string|null;created_at:string;reviewer_name:string}>(`SELECT ur.decision,ur.comment,ur.created_at,mu.name reviewer_name FROM upload_reviews ur JOIN meedoo_users mu ON mu.open_id=ur.reviewer_open_id WHERE ur.upload_id=$1 ORDER BY ur.created_at DESC`,[id]):{rows:[]};
  return { approver, record: result.rows[0] ?? null,history:history.rows };
}

export async function decideReview(id: string, reviewer: MeeDooUser, decision: "approved" | "rejected", comment: string) {
  if (!await isApprover(reviewer.openId)) throw new Error("APPROVER_REQUIRED");
  return transaction(async (client) => {
    const locked = await client.query<ReviewRecord>(`SELECT * FROM uploads WHERE id=$1 FOR UPDATE`, [id]);
    const upload = locked.rows[0];
    if (!upload || upload.review_status !== "pending") throw new Error("REVIEW_NOT_PENDING");
    if (decision === "rejected" && !comment.trim()) throw new Error("COMMENT_REQUIRED");
    const deleteAfter = decision === "rejected" ? "now()+interval '7 days'" : "NULL";
    await client.query(`UPDATE uploads SET review_status=$2,reviewed_by=$3,reviewed_at=now(),review_comment=$4,status=$5,media_delete_after=${deleteAfter},updated_at=now() WHERE id=$1`,
      [id,decision,reviewer.openId,comment.trim() || null,decision === "approved" ? "approved" : "rejected"]);
    await client.query(`INSERT INTO upload_reviews(upload_id,reviewer_open_id,decision,comment) VALUES($1,$2,$3,$4)`, [id,reviewer.openId,decision,comment.trim() || null]);
    if (decision === "approved") {
      const requestId = randomUUID();
      const selected = (upload.target_platforms ?? []).filter((item): item is UploadPostPlatform => supportedPlatforms.includes(item as UploadPostPlatform));
      await client.query(`UPDATE uploads SET request_id=$2 WHERE id=$1`, [id,requestId]);
      for (const platform of selected) await client.query(`INSERT INTO publications(upload_id,platform,request_id,status) VALUES($1,$2,$3,'queued') ON CONFLICT(upload_id,platform) DO NOTHING`, [id,platform,requestId]);
    }
    return { upload, decision };
  });
}
