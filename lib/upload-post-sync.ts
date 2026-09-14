import { updateUploadSummary } from "./publication-status";
import { withTikTokRetention } from "./tiktok-retention";
import { backfillTikTokRetention } from "./tiktok-retention-backfill";
import { expireDashboardCache, refreshDashboardCache } from "./dashboard-cache";
import { syncVideoMilestones } from "./video-milestones";
import { db, ensureSchema, query, transaction } from "./db";
import { flushNotifications } from "./notifications";
import { syntheticUuid } from "./records";
import {
  getUploadPostConfig,
  parseProviderResponse,
  uploadPostFetch,
  supportedPlatforms,
} from "./upload-post";
import { cleanupExpiredUploadSessions } from "./upload-staging";
import { runMaintenance } from "./maintenance";
import { syncProfileAnalytics } from "./profile-analytics";

type AnyRecord = Record<string, unknown>;
const stringValue = (value: unknown) =>
  typeof value === "string" ? value : null;
const boolValue = (value: unknown) =>
  typeof value === "boolean" ? value : null;
const failureStatuses = new Set(["failed", "error", "rejected"]);
const successStatuses = new Set(["completed", "success", "published"]);

function resultsList(value: unknown): AnyRecord[] {
  if (Array.isArray(value))
    return value.filter((item): item is AnyRecord =>
      Boolean(item && typeof item === "object"),
    );
  if (value && typeof value === "object")
    return Object.entries(value as AnyRecord).map(([platform, item]) => ({
      platform,
      ...(item && typeof item === "object" ? (item as AnyRecord) : {}),
    }));
  return [];
}

export async function applyStatusPayload(
  requestId: string,
  payload: AnyRecord,
) {
  await transaction(async (client) => {
    const found = await client.query<{ id: string }>(
      `SELECT u.id FROM uploads u WHERE u.removed_at IS NULL AND EXISTS
      (SELECT 1 FROM publications p WHERE p.upload_id=u.id AND p.removed_at IS NULL AND p.request_id=$1) FOR UPDATE`,
      [requestId],
    );
    for (const upload of found.rows) {
      const items = resultsList(payload.results ?? payload.platforms);
      for (const item of items) {
        const platform = stringValue(item.platform);
        if (!platform) continue;
        const rawStatus = stringValue(item.status)?.toLowerCase() ?? "";
        const error = stringValue(
          item.error_message ??
            item.error ??
            item.error_code ??
            item.failure_stage,
        );
        const success =
          item.success === true ||
          successStatuses.has(rawStatus) ||
          Boolean(
            item.platform_post_id ??
              item.post_id ??
              item.publish_id ??
              item.post_url ??
              item.url,
          );
        const failed =
          !success &&
          (Boolean(error) ||
            failureStatuses.has(rawStatus) ||
            item.success === false);
        const status = success ? "completed" : failed ? "failed" : "processing";
        await client.query(
          `UPDATE publications SET status=$4,success=$5,provider_job_id=COALESCE($6,provider_job_id),
          platform_post_id=COALESCE($7,platform_post_id),post_url=COALESCE($8,post_url),error_message=$9,
          last_synced_at=now(),updated_at=now() WHERE upload_id=$1 AND platform=$2 AND request_id=$3 AND removed_at IS NULL
          AND (status NOT IN ('completed','failed') OR $4 IN ('completed','failed'))`,
          [
            upload.id,
            platform,
            requestId,
            status,
            success ? true : failed ? false : null,
            stringValue(item.job_id),
            stringValue(
              item.platform_post_id ?? item.post_id ?? item.publish_id,
            ),
            stringValue(item.post_url ?? item.url),
            failed ? (error ?? "Publishing failed") : null,
          ],
        );
      }
      if (!items.length && failureStatuses.has(String(payload.status))) {
        await client.query(
          `UPDATE publications SET status='failed',success=false,error_message='Publishing failed',updated_at=now()
          WHERE upload_id=$1 AND request_id=$2 AND removed_at IS NULL AND status NOT IN ('completed','failed')`,
          [upload.id, requestId],
        );
      }
      await updateUploadSummary(client, upload.id);
    }
  });
}

export async function syncHistory() {
  const { profile } = getUploadPostConfig();
  const response = await uploadPostFetch(
    `/api/uploadposts/history?limit=100&profile_username=${encodeURIComponent(profile)}`,
  );
  const payload = await parseProviderResponse(response);
  if (!response.ok) throw new Error("UPLOAD_POST_HISTORY_FAILED");
  const rows = Array.isArray(payload.history)
    ? (payload.history as AnyRecord[])
    : [];
  const historyAfter = Date.parse(process.env.UPLOAD_POST_HISTORY_AFTER ?? "");
  let imported = 0;
  for (const row of rows) {
    const requestId =
      stringValue(row.request_id) ??
      stringValue(row.external_id) ??
      stringValue(row.job_id);
    const platform = stringValue(row.platform);
    if (
      !requestId ||
      !platform ||
      !supportedPlatforms.some((item) => item === platform)
    )
      continue;
    const uploadTimestamp = Date.parse(stringValue(row.upload_timestamp) ?? "");
    if (
      Number.isFinite(historyAfter) &&
      (!Number.isFinite(uploadTimestamp) || uploadTimestamp < historyAfter)
    )
      continue;
    const uploadId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(
      stringValue(row.external_id) ?? "",
    )
      ? stringValue(row.external_id)!
      : syntheticUuid(requestId);
    const createdAt =
      stringValue(row.upload_timestamp) ?? new Date().toISOString();
    await transaction(async (client) => {
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT u.id,u.status FROM uploads u WHERE u.removed_at IS NULL AND (u.request_id=$1 OR u.id=$2 OR EXISTS
        (SELECT 1 FROM publications p WHERE p.upload_id=u.id AND p.request_id=$1)) LIMIT 1 FOR UPDATE`,
        [requestId, uploadId],
      );
      if (!existing.rows[0])
        await client.query(
          `INSERT INTO uploads(id,request_id,provider_job_id,profile_username,title,caption,media_size_bytes,status,target_platforms,imported,created_at,updated_at,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,ARRAY[$9],true,$10,$10,CASE WHEN $8 IN ('completed','failed') THEN $10::timestamptz END)
        ON CONFLICT(request_id) DO UPDATE SET target_platforms=(SELECT ARRAY(SELECT DISTINCT unnest(uploads.target_platforms || excluded.target_platforms))),updated_at=now()
          WHERE uploads.removed_at IS NULL`,
          [
            uploadId,
            requestId,
            stringValue(row.job_id),
            stringValue(row.profile_username) ?? profile,
            stringValue(row.post_title) ?? "Untitled import",
            stringValue(row.post_caption) ?? "",
            Number(row.media_size_bytes ?? 0) || null,
            row.success === false ? "failed" : "completed",
            platform,
            createdAt,
          ],
        );
      const selected = await client.query<{ id: string }>(
        `SELECT id FROM uploads WHERE request_id=$1 AND removed_at IS NULL`,
        [requestId],
      );
      const actualUploadId = existing.rows[0]?.id ?? selected.rows[0]?.id;
      if (!actualUploadId) return;
      await client.query(
        `INSERT INTO publications(upload_id,platform,request_id,provider_job_id,platform_post_id,status,success,post_url,error_message,fallback_to_inbox,last_synced_at,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$11)
        ON CONFLICT(upload_id,platform) DO UPDATE SET provider_job_id=COALESCE(excluded.provider_job_id,publications.provider_job_id),
          platform_post_id=COALESCE(excluded.platform_post_id,publications.platform_post_id),status=excluded.status,success=excluded.success,
          post_url=COALESCE(excluded.post_url,publications.post_url),error_message=excluded.error_message,last_synced_at=now(),updated_at=now()
          WHERE publications.removed_at IS NULL AND publications.request_id=excluded.request_id`,
        [
          actualUploadId,
          platform,
          requestId,
          stringValue(row.job_id),
          stringValue(row.platform_post_id),
          row.success === false ? "failed" : "completed",
          boolValue(row.success),
          stringValue(row.post_url),
          stringValue(row.error_message),
          Boolean(row.fallback_to_inbox),
          createdAt,
        ],
      );
      if (
        existing.rows[0] &&
        !["completed", "failed"].includes(existing.rows[0].status)
      )
        await updateUploadSummary(client, actualUploadId);
    });
    imported++;
  }
  return imported;
}

export async function syncPendingStatuses() {
  const pending = await query<{
    request_id: string;
  }>(`SELECT DISTINCT p.request_id FROM publications p JOIN uploads u ON u.id=p.upload_id
    WHERE p.removed_at IS NULL AND u.removed_at IS NULL AND p.request_id IS NOT NULL AND p.status NOT IN ('completed','failed')`);
  for (const row of pending.rows) {
    try {
      const response = await uploadPostFetch(
        `/api/uploadposts/status?request_id=${encodeURIComponent(row.request_id)}`,
      );
      if (response.ok)
        await applyStatusPayload(
          row.request_id,
          await parseProviderResponse(response),
        );
    } catch {
      console.error("Publication status check failed");
    }
  }
  return pending.rowCount ?? 0;
}

export async function syncAnalytics() {
  const { profile } = getUploadPostConfig();
  // Fair rotation includes organic videos. Attempt time advances even on API errors.
  const jobs = await query<{
    id: string;
    request_id: string | null;
    platform: string;
    platform_post_id: string | null;
    video_duration_seconds: string | null;
  }>(`SELECT p.id,p.request_id,p.platform,p.platform_post_id,u.video_duration_seconds
    FROM publications p JOIN uploads u ON u.id=p.upload_id WHERE u.removed_at IS NULL AND p.removed_at IS NULL AND p.status='completed'
    AND (p.platform_post_id IS NOT NULL OR p.request_id IS NOT NULL)
    ORDER BY p.analytics_attempted_at NULLS FIRST,p.id LIMIT 80`);
  let updated = 0;
  const deadline = Date.now() + 180_000;
  for (const job of jobs.rows) {
    if (Date.now() >= deadline) break;
    await query(
      "UPDATE publications SET analytics_attempted_at=now() WHERE id=$1",
      [job.id],
    );
    const params = new URLSearchParams({
      platform: job.platform,
      user: profile,
    });
    if (job.platform_post_id)
      params.set("platform_post_id", job.platform_post_id);
    const endpoint = job.platform_post_id
      ? `/api/uploadposts/post-analytics?${params}`
      : `/api/uploadposts/post-analytics/${encodeURIComponent(job.request_id!)}?${params}`;
    try {
      const response = await uploadPostFetch(endpoint);
      if (!response.ok) continue;
      const payload = await parseProviderResponse(response);
      const item = resultsList(payload.platforms).find(
        (item) => item.platform === job.platform,
      );
      const metrics = item?.post_metrics ?? item?.metrics;
      if (!metrics || typeof metrics !== "object" || Array.isArray(metrics))
        continue;
      await query(
        `INSERT INTO metric_snapshots(publication_id,captured_at,metrics)
        SELECT id,clock_timestamp(),$2::jsonb FROM publications WHERE id=$1 AND removed_at IS NULL`,
        [
          job.id,
          JSON.stringify(
            job.platform === "tiktok"
              ? withTikTokRetention(
                  metrics as Record<string, unknown>,
                  job.video_duration_seconds,
                )
              : metrics,
          ),
        ],
      );
      await query("UPDATE publications SET last_synced_at=now() WHERE id=$1", [
        job.id,
      ]);
      updated++;
    } catch {
      console.error("Publication analytics check failed");
    }
  }
  return updated;
}

async function runSync() {
  await flushNotifications();
  const cleaned = await cleanupExpiredUploadSessions();
  const maintenance = await runMaintenance();
  const history = await syncHistory();
  const statuses = await syncPendingStatuses();
  const analytics = await syncAnalytics();
  let profileAnalytics: unknown;
  try {
    profileAnalytics = await syncProfileAnalytics();
  } catch (error) {
    profileAnalytics = {
      error:
        error instanceof Error ? error.message : "PROFILE_ANALYTICS_FAILED",
    };
  }
  let milestones: unknown;
  try {
    milestones = await syncVideoMilestones();
  } catch (error) {
    console.error(
      "Video milestone detection failed",
      error instanceof Error ? error.message : "unknown",
    );
    milestones = { error: "MILESTONE_DETECTION_FAILED" };
  }
  await backfillTikTokRetention();
  await refreshDashboardCache();
  return {
    cleaned,
    history,
    statuses,
    analytics,
    profileAnalytics,
    maintenance,
    milestones,
    syncedAt: new Date().toISOString(),
  };
}

export async function syncAll() {
  await ensureSchema();
  const client = await db().connect();
  let locked = false;
  try {
    locked = (
      await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(7241902) locked",
      )
    ).rows[0].locked;
    if (!locked) return { alreadyRunning: true };
    return await runSync();
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(7241902)");
    } catch {
      client.release(true);
      throw new Error("SYNC_LOCK_RELEASE_FAILED");
    }
    client.release();
  }
}
