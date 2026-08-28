import { query, transaction } from "./db";
import { createNotification } from "./notifications";
import { syntheticUuid } from "./records";
import { getUploadPostConfig, parseProviderResponse, uploadPostFetch } from "./upload-post";
import { cleanupExpiredUploadSessions } from "./upload-staging";

type AnyRecord = Record<string, unknown>;
const stringValue = (value: unknown) => typeof value === "string" ? value : null;
const boolValue = (value: unknown) => typeof value === "boolean" ? value : null;
const failureStatuses = new Set(["failed", "error", "rejected"]);
const successStatuses = new Set(["completed", "success", "published"]);

function resultsList(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is AnyRecord => Boolean(item && typeof item === "object"));
  if (value && typeof value === "object") return Object.entries(value as AnyRecord).map(([platform, item]) => ({
    platform, ...(item && typeof item === "object" ? item as AnyRecord : {}),
  }));
  return [];
}

export async function applyStatusPayload(requestId: string, payload: AnyRecord) {
  const status = stringValue(payload.status) ?? "processing";
  const before = await query<{ id:string;status:string;title:string }>(`SELECT DISTINCT u.id,u.status,u.title FROM uploads u LEFT JOIN publications p ON p.upload_id=u.id WHERE u.request_id=$1 OR p.request_id=$1 LIMIT 1`,[requestId]);
  const previousStatus = before.rows[0]?.status;
  const uploadResult = await query<{ id: string; status: string; title: string }>(`UPDATE uploads SET status=$2,provider_job_id=COALESCE($3,provider_job_id),
    updated_at=now(),completed_at=CASE WHEN $2 IN ('completed','failed') THEN COALESCE(completed_at,now()) ELSE completed_at END
    WHERE id=(SELECT DISTINCT u.id FROM uploads u LEFT JOIN publications p ON p.upload_id=u.id WHERE u.request_id=$1 OR p.request_id=$1 LIMIT 1) RETURNING id,status,title`, [requestId,status,stringValue(payload.job_id)]);
  const upload = uploadResult.rows[0];
  if (!upload) return;
  for (const item of resultsList(payload.results ?? payload.platforms)) {
    const platform = stringValue(item.platform);
    if (!platform) continue;
    const rawItemStatus = stringValue(item.status)?.toLowerCase() ?? null;
    const errorMessage = stringValue(item.error_message ?? item.error);
    const errorCode = stringValue(item.error_code);
    const failureStage = stringValue(item.failure_stage);
    const hasExplicitFailure = Boolean(errorMessage || errorCode || failureStage) || failureStatuses.has(rawItemStatus ?? "");
    const hasExplicitSuccess = item.success === true || successStatuses.has(rawItemStatus ?? "")
      || Boolean(stringValue(item.platform_post_id ?? item.post_id ?? item.publish_id) || stringValue(item.post_url ?? item.url));
    const terminalRequest = ["completed", "failed"].includes(status);
    const itemStatus = hasExplicitSuccess ? "completed" : hasExplicitFailure || (terminalRequest && item.success === false) ? "failed" : "processing";
    const itemSuccess = itemStatus === "completed" ? true : itemStatus === "failed" ? false : null;
    await query(`UPDATE publications SET status=$3,success=$4,provider_job_id=COALESCE($5,provider_job_id),
      platform_post_id=COALESCE($6,platform_post_id),post_url=COALESCE($7,post_url),error_message=$8,
      fallback_to_inbox=COALESCE($9,fallback_to_inbox),last_synced_at=now(),updated_at=now()
      WHERE upload_id=$1 AND platform=$2`, [upload.id,platform,itemStatus,itemSuccess,stringValue(item.job_id),
      stringValue(item.platform_post_id ?? item.post_id ?? item.publish_id),stringValue(item.post_url ?? item.url),
      itemStatus === "failed" ? errorMessage ?? stringValue(item.message) ?? errorCode ?? failureStage : null,boolValue(item.fallback_to_inbox)]);
  }
  if (["completed","failed"].includes(status) && previousStatus !== status) {
    await createNotification(upload.id, `publish_${status}`, status === "completed" ? `MeeDoo: “${upload.title}” publishing completed.` : `MeeDoo: “${upload.title}” publishing failed. Open MeeDoo to retry.`);
  }
}

export async function syncHistory() {
  const { profile } = getUploadPostConfig();
  const response = await uploadPostFetch(`/api/uploadposts/history?limit=100&profile_username=${encodeURIComponent(profile)}`);
  const payload = await parseProviderResponse(response);
  if (!response.ok) throw new Error("UPLOAD_POST_HISTORY_FAILED");
  const rows = Array.isArray(payload.history) ? payload.history as AnyRecord[] : [];
  const historyAfter = Date.parse(process.env.UPLOAD_POST_HISTORY_AFTER ?? "");
  let imported = 0;
  for (const row of rows) {
    const requestId = stringValue(row.request_id) ?? stringValue(row.external_id) ?? stringValue(row.job_id);
    const platform = stringValue(row.platform);
    if (!requestId || !platform) continue;
    const uploadTimestamp = Date.parse(stringValue(row.upload_timestamp) ?? "");
    if (Number.isFinite(historyAfter) && (!Number.isFinite(uploadTimestamp) || uploadTimestamp < historyAfter)) continue;
    const uploadId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(stringValue(row.external_id) ?? "")
      ? stringValue(row.external_id)! : syntheticUuid(requestId);
    const createdAt = stringValue(row.upload_timestamp) ?? new Date().toISOString();
    await transaction(async (client) => {
      await client.query(`INSERT INTO uploads(id,request_id,provider_job_id,profile_username,title,caption,media_size_bytes,status,target_platforms,imported,created_at,updated_at,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,ARRAY[$9],true,$10,$10,CASE WHEN $8 IN ('completed','failed') THEN $10::timestamptz END)
        ON CONFLICT(request_id) DO UPDATE SET provider_job_id=COALESCE(excluded.provider_job_id,uploads.provider_job_id),
          status=excluded.status,target_platforms=(SELECT ARRAY(SELECT DISTINCT unnest(uploads.target_platforms || excluded.target_platforms))),updated_at=now()`,
      [uploadId,requestId,stringValue(row.job_id),stringValue(row.profile_username) ?? profile,stringValue(row.post_title) ?? "Untitled import",
       stringValue(row.post_caption) ?? "",Number(row.media_size_bytes ?? 0) || null,row.success === false ? "failed" : "completed",platform,createdAt]);
      const selected = await client.query<{ id: string }>(`SELECT id FROM uploads WHERE request_id=$1`, [requestId]);
      const actualUploadId = selected.rows[0]?.id ?? uploadId;
      await client.query(`INSERT INTO publications(upload_id,platform,request_id,provider_job_id,platform_post_id,status,success,post_url,error_message,fallback_to_inbox,last_synced_at,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$11)
        ON CONFLICT(upload_id,platform) DO UPDATE SET provider_job_id=COALESCE(excluded.provider_job_id,publications.provider_job_id),
          platform_post_id=COALESCE(excluded.platform_post_id,publications.platform_post_id),status=excluded.status,success=excluded.success,
          post_url=COALESCE(excluded.post_url,publications.post_url),error_message=excluded.error_message,last_synced_at=now(),updated_at=now()`,
      [actualUploadId,platform,requestId,stringValue(row.job_id),stringValue(row.platform_post_id),row.success === false ? "failed" : "completed",
       boolValue(row.success),stringValue(row.post_url),stringValue(row.error_message),Boolean(row.fallback_to_inbox),createdAt]);
    });
    imported++;
  }
  return imported;
}

export async function syncPendingStatuses() {
  const pending = await query<{ request_id: string }>(`SELECT request_id FROM uploads WHERE request_id IS NOT NULL AND status NOT IN ('completed','failed') ORDER BY created_at DESC LIMIT 50`);
  for (const row of pending.rows) {
    const response = await uploadPostFetch(`/api/uploadposts/status?request_id=${encodeURIComponent(row.request_id)}`);
    if (response.ok) await applyStatusPayload(row.request_id, await parseProviderResponse(response));
  }
  return pending.rowCount ?? 0;
}

export async function syncAnalytics() {
  const uploads = await query<{ id: string; request_id: string }>(`SELECT DISTINCT ON (u.id,p.request_id) u.id,p.request_id FROM uploads u JOIN publications p ON p.upload_id=u.id WHERE p.request_id IS NOT NULL AND p.status='completed' ORDER BY u.id,p.request_id,u.created_at DESC LIMIT 50`);
  let updated = 0;
  for (const upload of uploads.rows) {
    const response = await uploadPostFetch(`/api/uploadposts/post-analytics/${encodeURIComponent(upload.request_id)}`);
    if (!response.ok) continue;
    const payload = await parseProviderResponse(response);
    for (const item of resultsList(payload.platforms)) {
      const platform = stringValue(item.platform);
      const metrics = item.post_metrics ?? item.metrics;
      if (!platform || !metrics || typeof metrics !== "object") continue;
      const publication = await query<{ id: string }>(`UPDATE publications SET platform_post_id=COALESCE($3,platform_post_id),post_url=COALESCE($4,post_url),last_synced_at=now(),updated_at=now()
        WHERE upload_id=$1 AND platform=$2 RETURNING id`, [upload.id,platform,stringValue(item.platform_post_id),stringValue(item.post_url)]);
      if (!publication.rows[0]) continue;
      await query(`INSERT INTO metric_snapshots(publication_id,captured_at,metrics) VALUES($1,date_trunc('minute',now()),$2::jsonb)
        ON CONFLICT(publication_id,captured_at) DO UPDATE SET metrics=excluded.metrics`, [publication.rows[0].id,JSON.stringify(metrics)]);
      updated++;
    }
  }
  return updated;
}

export async function syncAll() {
  const cleaned = await cleanupExpiredUploadSessions();
  const history = await syncHistory();
  const statuses = await syncPendingStatuses();
  const analytics = await syncAnalytics();
  return { cleaned, history, statuses, analytics, syncedAt: new Date().toISOString() };
}
