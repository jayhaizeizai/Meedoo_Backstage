import { query } from "./db";
import { equivalentRetention } from "./equivalent-retention";

export const videoMetricDefinitions = [
  { key: "views", zh: "浏览 / 触达", en: "Views / Reach" },
  { key: "likes", zh: "点赞", en: "Likes" },
  { key: "retention", zh: "等效留存评分", en: "Equivalent Retention Score" },
  { key: "shares", zh: "分享 / 转发 / 发送", en: "Shares / Reposts / Sends" },
  { key: "followers", zh: "估算新增粉丝 / 订阅", en: "Estimated new followers / Subscribers" },
  { key: "saves", zh: "收藏", en: "Saves" },
  { key: "comments", zh: "评论", en: "Comments" },
] as const;

const platforms = ["tiktok", "instagram", "youtube"] as const;
const checkpoints = [15, 30, 60, 120, 240, 480, 720, 1440];
type MetricKey = typeof videoMetricDefinitions[number]["key"];
type Metrics = Record<MetricKey, number | null>;
type Platform = typeof platforms[number];
type UploadRow = { id: string; title: string; uploader_open_id: string | null; uploader_name: string | null; created_at: string; status: string; video_duration_seconds: number | string | null };
type SnapshotRow = UploadRow & { publication_id: string; platform: string; post_url: string | null; publication_status: string; captured_at: string | null; metrics: Record<string, unknown> | null; attributed_followers: number | string | null };

const aliases: Record<Exclude<MetricKey, "views">, string[]> = {
  likes: ["likes", "like_count"], retention: [],
  shares: ["shares", "share_count"],
  followers: ["followers_gained", "new_followers", "subscribers_gained", "new_subscribers"],
  saves: ["saves", "favorites", "favorite_count", "bookmarks"], comments: ["comments", "comment_count", "replies"],
};

function emptyMetrics(): Metrics {
  return Object.fromEntries(videoMetricDefinitions.map(({ key }) => [key, null])) as Metrics;
}

function numberFrom(metrics: Record<string, unknown> | null, keys: string[]) {
  if (!metrics) return null;
  for (const key of keys) {
    const value = metrics[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalize(platform: string, metrics: Record<string, unknown> | null, attributedFollowers: number | string | null = null, duration: number | string | null = null): Metrics {
  return Object.fromEntries(videoMetricDefinitions.map(({ key }) => [key, key === "views"
    ? numberFrom(metrics, platform === "instagram" ? ["reach", "views", "impressions"] : ["views", "reach", "impressions"])
    : key === "retention" ? equivalentRetention(platform, metrics, duration)
    : key === "followers" ? numberFrom(metrics, aliases.followers) ?? (attributedFollowers === null ? null : Number(attributedFollowers))
    : key === "shares" ? sumAvailable(
      numberFrom(metrics, aliases.shares),
      numberFrom(metrics, ["reposts", "repost_count", "repost"]),
    )
    : numberFrom(metrics, aliases[key])])) as Metrics;
}

function sumAvailable(...values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

function aggregate(values: Metrics[]) {
  const result = emptyMetrics();
  for (const { key } of videoMetricDefinitions) {
    const available = values.map((metrics) => metrics[key]).filter((value): value is number => value !== null);
    if (!available.length) continue;
    if (key === "retention") {
      const weighted = values.filter((metrics) => metrics.retention !== null && metrics.views !== null && metrics.views > 0);
      result[key] = weighted.length ? weighted.reduce((sum, metrics) => sum + metrics.retention! * metrics.views!, 0) / weighted.reduce((sum, metrics) => sum + metrics.views!, 0) : available.reduce((sum, value) => sum + value, 0) / available.length;
    } else result[key] = available.reduce((sum, value) => sum + value, 0);
  }
  return result;
}

function average(values: Metrics[]) {
  const result = emptyMetrics();
  for (const { key } of videoMetricDefinitions) {
    const available = values.map((metrics) => metrics[key]).filter((value): value is number => value !== null);
    if (available.length) result[key] = available.reduce((sum, value) => sum + value, 0) / available.length;
  }
  return result;
}

type TimelinePoint = { minute: number; metrics: Record<"all" | Platform, Metrics> };
type Timeline = { uploadId: string; fallback: boolean; points: TimelinePoint[] };

function timelineForUpload(rows: SnapshotRow[], requestedCheckpoints: number[]): Timeline {
  const createdAt = Date.parse(rows[0].created_at);
  const byPublication = new Map<string, SnapshotRow[]>();
  for (const row of rows) byPublication.set(row.publication_id, [...(byPublication.get(row.publication_id) ?? []), row]);
  for (const publicationRows of byPublication.values()) publicationRows.sort((a, b) => Date.parse(a.captured_at ?? "") - Date.parse(b.captured_at ?? ""));
  const hasRealHistory = rows.some((row) => row.captured_at && Date.parse(row.captured_at) >= createdAt && Date.parse(row.captured_at) <= createdAt + 24 * 60 * 60 * 1000);
  const latestByPublication = new Map([...byPublication].map(([id, publicationRows]) => [id, [...publicationRows].reverse().find((row) => row.metrics) ?? publicationRows.at(-1)!]));
  const points = requestedCheckpoints.map((minute) => {
    const cutoff = createdAt + minute * 60_000;
    const selected = [...byPublication].map(([id, publicationRows]) => {
      if (!hasRealHistory) return latestByPublication.get(id)!;
      return [...publicationRows].reverse().find((row) => row.captured_at && Date.parse(row.captured_at) <= cutoff && row.metrics) ?? null;
    }).filter((row): row is SnapshotRow => Boolean(row));
    const perPlatform = Object.fromEntries(platforms.map((platform) => [platform, aggregate(selected.filter((row) => row.platform === platform).map((row) => normalize(row.platform, row.metrics, row.attributed_followers, row.video_duration_seconds)))])) as Record<Platform, Metrics>;
    return { minute, metrics: { all: aggregate(Object.values(perPlatform)), ...perPlatform } };
  });
  return { uploadId: rows[0].id, fallback: !hasRealHistory, points };
}

function benchmark(timelines: Timeline[]) {
  return checkpoints.map((minute, index) => ({
    minute,
    metrics: Object.fromEntries((["all", ...platforms] as const).map((platform) => [platform,
      average(timelines.map((timeline) => timeline.points[index].metrics[platform]))])) as Record<"all" | Platform, Metrics>,
  }));
}

export async function getVideoDetailData(uploadId: string) {
  const targetResult = await query<UploadRow>(`SELECT id::text,title,uploader_open_id,uploader_name,created_at,status,video_duration_seconds FROM uploads WHERE id=$1 AND removed_at IS NULL`, [uploadId]);
  const video = targetResult.rows[0];
  if (!video) return null;
  const cohortResult = await query<{ id: string; cohort: string }>(`WITH target AS (SELECT uploader_open_id,uploader_name FROM uploads WHERE id=$1 AND removed_at IS NULL),
    owner_recent AS (SELECT u.id::text,'owner' cohort FROM uploads u,target t WHERE u.id<>$1 AND u.removed_at IS NULL AND
      ((t.uploader_open_id IS NOT NULL AND u.uploader_open_id=t.uploader_open_id) OR (t.uploader_open_id IS NULL AND u.uploader_open_id IS NULL AND u.uploader_name IS NOT DISTINCT FROM t.uploader_name))
      ORDER BY u.created_at DESC LIMIT 10),
    team_recent AS (SELECT id::text,'team' cohort FROM uploads WHERE id<>$1 AND removed_at IS NULL ORDER BY created_at DESC LIMIT 30)
    SELECT * FROM owner_recent UNION ALL SELECT * FROM team_recent`, [uploadId]);
  const ownerIds = cohortResult.rows.filter((row) => row.cohort === "owner").map((row) => row.id);
  const teamIds = cohortResult.rows.filter((row) => row.cohort === "team").map((row) => row.id);
  const ids = [...new Set([uploadId, ...ownerIds, ...teamIds])];
  const snapshotResult = await query<SnapshotRow>(`SELECT u.id::text,u.title,u.uploader_open_id,u.uploader_name,u.created_at,u.status,u.video_duration_seconds,
      p.id::text publication_id,p.platform,p.post_url,p.status publication_status,ms.captured_at,ms.metrics,
      (SELECT sum(a.attributed_followers)::double precision FROM publication_follower_attributions a JOIN profile_metric_snapshots ps ON ps.id=a.profile_snapshot_id
        WHERE a.publication_id=p.id AND (ms.captured_at IS NULL OR ps.captured_at<=ms.captured_at)) attributed_followers
    FROM uploads u JOIN publications p ON p.upload_id=u.id
    LEFT JOIN metric_snapshots ms ON ms.publication_id=p.id
    WHERE u.removed_at IS NULL AND p.removed_at IS NULL AND u.id=ANY($1::uuid[]) ORDER BY u.created_at DESC,p.id,ms.captured_at`, [ids]);
  const grouped = new Map<string, SnapshotRow[]>();
  for (const row of snapshotResult.rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
  const elapsedMinutes = Math.max(1, Math.min(1440, Math.floor((Date.now() - Date.parse(video.created_at)) / 60_000)));
  const targetCheckpoints = [...new Set([...checkpoints.filter((minute) => minute <= elapsedMinutes), elapsedMinutes])].sort((a, b) => a - b);
  const targetRows = grouped.get(uploadId) ?? [];
  const target = targetRows.length ? timelineForUpload(targetRows, targetCheckpoints) : { uploadId, fallback: true, points: [] };
  const ownerTimelines = ownerIds.flatMap((id) => grouped.has(id) ? [timelineForUpload(grouped.get(id)!, checkpoints)] : []);
  const teamTimelines = teamIds.flatMap((id) => grouped.has(id) ? [timelineForUpload(grouped.get(id)!, checkpoints)] : []);
  const latestRows = [...new Map(targetRows.map((row) => [row.publication_id, row])).values()].map((publication) => {
    const publicationRows = targetRows.filter((row) => row.publication_id === publication.publication_id);
    return [...publicationRows].reverse().find((row) => row.metrics) ?? publication;
  });
  const currentByPlatform = Object.fromEntries(platforms.map((platform) => [platform,
    aggregate(latestRows.filter((row) => row.platform === platform).map((row) => normalize(row.platform, row.metrics, row.attributed_followers, row.video_duration_seconds)))])) as Record<Platform, Metrics>;
  const currentMetrics = { all: aggregate(Object.values(currentByPlatform)), ...currentByPlatform };
  const platformRows = [...new Map(targetRows.map((row) => [row.publication_id, row])).values()];
  return {
    updatedAt: new Date().toISOString(), metricDefinitions: videoMetricDefinitions,
    video: { id: video.id, title: video.title, ownerId: video.uploader_open_id, owner: video.uploader_name ?? "Historical import", createdAt: video.created_at, status: video.status,
      platforms: platformRows.map((row) => ({ platform: row.platform, url: row.post_url, status: row.publication_status })), metrics: currentMetrics },
    timeline: { target, owner: { count: ownerTimelines.length, points: benchmark(ownerTimelines), fallbackCount: ownerTimelines.filter((item) => item.fallback).length },
      team: { count: teamTimelines.length, points: benchmark(teamTimelines), fallbackCount: teamTimelines.filter((item) => item.fallback).length } },
  };
}
