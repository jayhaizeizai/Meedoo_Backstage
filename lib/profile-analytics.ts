import { PoolClient } from "pg";
import { transaction } from "./db";
import { getUploadPostConfig, parseProviderResponse, supportedPlatforms, uploadPostFetch, UploadPostPlatform } from "./upload-post";

type AnyRecord = Record<string, unknown>;
type Candidate = { publication_id: string; current_metrics: AnyRecord | null; previous_metrics: AnyRecord | null };

function record(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : null;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function followersFrom(value: AnyRecord | null) {
  if (!value) return null;
  for (const key of ["followers", "subscribers", "follower_count", "subscriber_count"]) {
    const parsed = numeric(value[key]);
    if (parsed !== null) return Math.max(0, Math.round(parsed));
  }
  return null;
}

function viewsFrom(platform: UploadPostPlatform, metrics: AnyRecord | null) {
  if (!metrics) return null;
  const keys = platform === "instagram" ? ["reach", "views", "impressions"] : ["views", "impressions", "reach"];
  for (const key of keys) {
    const parsed = numeric(metrics[key]);
    if (parsed !== null) return Math.max(0, parsed);
  }
  return null;
}

function integerAllocations(total: number, weights: number[]) {
  if (!weights.length || total <= 0) return weights.map(() => 0);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0) return weights.map(() => 0);
  const raw = weights.map((value) => total * value / weightTotal);
  const allocations = raw.map(Math.floor);
  let remainder = total - allocations.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - allocations[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < order.length && remainder > 0; index++, remainder--) allocations[order[index].index]++;
  return allocations;
}

async function attributeFollowerGain(client: PoolClient, platform: UploadPostPlatform, snapshotId: string, capturedAt: string, followers: number) {
  const previous = await client.query<{ id: string; captured_at: string; followers: string | null; previous_high: string | null }>(`SELECT id::text,captured_at,followers::text,
      (SELECT max(followers)::text FROM profile_metric_snapshots WHERE platform=$1 AND captured_at<$2) previous_high
    FROM profile_metric_snapshots WHERE platform=$1 AND captured_at<$2 ORDER BY captured_at DESC LIMIT 1`, [platform, capturedAt]);
  const prior = previous.rows[0];
  if (!prior?.followers) return { gained: 0, attributed: 0, candidates: 0, baseline: false };
  const gained = Math.max(0, followers - Number(prior.previous_high ?? prior.followers));
  await client.query(`DELETE FROM publication_follower_attributions WHERE profile_snapshot_id=$1`, [snapshotId]);

  const candidates = await client.query<Candidate>(`SELECT p.id::text publication_id,current_snapshot.metrics current_metrics,previous_snapshot.metrics previous_metrics
    FROM publications p JOIN uploads u ON u.id=p.upload_id
    LEFT JOIN LATERAL (SELECT metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id AND ms.captured_at<=$2 ORDER BY ms.captured_at DESC LIMIT 1) current_snapshot ON true
    LEFT JOIN LATERAL (SELECT metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id AND ms.captured_at<=$3 ORDER BY ms.captured_at DESC LIMIT 1) previous_snapshot ON true
    WHERE p.platform=$1 AND p.status='completed' AND p.removed_at IS NULL AND u.removed_at IS NULL AND u.review_status='approved'
      AND p.created_at<=$2 AND p.created_at>$3::timestamptz-interval '96 hours'`, [platform, capturedAt, prior.captured_at]);
  if (!candidates.rowCount) return { gained, attributed: 0, candidates: 0, baseline: true };
  const weights = candidates.rows.map((candidate) => Math.max(0,
    (viewsFrom(platform, candidate.current_metrics) ?? 0) - (viewsFrom(platform, candidate.previous_metrics) ?? 0)));
  const allocations = integerAllocations(gained, weights);
  for (let index = 0; index < candidates.rows.length; index++) {
    await client.query(`INSERT INTO publication_follower_attributions(publication_id,profile_snapshot_id,attributed_followers)
      VALUES($1,$2,$3) ON CONFLICT(publication_id,profile_snapshot_id) DO UPDATE SET attributed_followers=excluded.attributed_followers`,
    [candidates.rows[index].publication_id, snapshotId, allocations[index]]);
  }
  return { gained, attributed: allocations.reduce((sum, value) => sum + value, 0), candidates: candidates.rows.length, baseline: true };
}

export async function syncProfileAnalytics() {
  const { profile } = getUploadPostConfig();
  const response = await uploadPostFetch(`/api/analytics/${encodeURIComponent(profile)}?platforms=${supportedPlatforms.join(",")}`);
  const payload = await parseProviderResponse(response);
  if (!response.ok) throw new Error("UPLOAD_POST_PROFILE_ANALYTICS_FAILED");
  const root = record(payload.platforms) ?? payload;
  const capturedAt = new Date();
  capturedAt.setSeconds(0, 0);
  const result: Record<string, unknown> = { capturedAt: capturedAt.toISOString(), platforms: {} };
  for (const platform of supportedPlatforms) {
    const metrics = record(root[platform]);
    const followers = followersFrom(metrics);
    if (followers === null || !metrics) {
      (result.platforms as AnyRecord)[platform] = { available: false };
      continue;
    }
    (result.platforms as AnyRecord)[platform] = await transaction(async (client) => {
      const inserted = await client.query<{ id: string; captured_at: string }>(`INSERT INTO profile_metric_snapshots(platform,captured_at,followers,metrics)
        VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(platform,captured_at) DO UPDATE SET followers=excluded.followers,metrics=excluded.metrics
        RETURNING id::text,captured_at`, [platform, capturedAt.toISOString(), followers, JSON.stringify(metrics)]);
      const attribution = await attributeFollowerGain(client, platform, inserted.rows[0].id, inserted.rows[0].captured_at, followers);
      return { available: true, followers, ...attribution };
    });
  }
  return result;
}
