import { viewMetricKeys } from "./social-platforms";
import { query } from "./db";
import {
  tiktokRetentionScore,
  storedTikTokRetention,
} from "./tiktok-retention";

export type WeeklyConversionMetrics = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  followers: number;
  engagementActions: number;
  engagementRate: number | null;
  followerRate: number | null;
  websiteRate: null;
};

type WeeklyRow = {
  upload_id: string;
  title: string;
  created_at: string;
  video_duration_seconds: number | string | null;
  uploader_open_id: string | null;
  uploader_name: string | null;
  avatar_url: string | null;
  platform: string;
  metrics: Record<string, unknown> | null;
  attributed_followers: number | string | null;
  captured_at: string | null;
};

export type WeeklyPlatformResult = {
  platform: string;
  capturedAt: string | null;
  website: null;
  reposts: number | null;
  shares: number | null;
  followers: number | null;
  completionRate: number | null;
  retentionScore: number | null;
  averageViewPercentage: number | null;
  saves: number | null;
  comments: number | null;
  views: number | null;
  likes: number | null;
};

const valueFrom = (metrics: Record<string, unknown> | null, keys: string[]) => {
  if (!metrics) return null;
  for (const key of keys) {
    const raw = metrics[key];
    const value =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number(raw)
          : Number.NaN;
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const availableSum = (...values: Array<number | null>) => {
  const available = values.filter((value): value is number => value !== null);
  return available.length
    ? available.reduce((sum, value) => sum + value, 0)
    : 0;
};

function summarize(rows: WeeklyRow[]): WeeklyConversionMetrics {
  const totals = rows.reduce(
    (result, row) => {
      const viewKeys = viewMetricKeys(row.platform);
      result.views += valueFrom(row.metrics, viewKeys) ?? 0;
      result.likes +=
        valueFrom(row.metrics, ["likes", "like_count", "reactions"]) ?? 0;
      result.comments +=
        valueFrom(row.metrics, ["comments", "comment_count", "replies"]) ?? 0;
      result.shares += availableSum(
        valueFrom(row.metrics, ["shares", "share_count"]),
        valueFrom(row.metrics, [
          "reposts",
          "repost_count",
          "repost",
          "retweets",
          "retweet_count",
        ]),
      );
      result.saves +=
        valueFrom(row.metrics, [
          "saves",
          "favorites",
          "favorite_count",
          "bookmarks",
        ]) ?? 0;
      result.followers +=
        valueFrom(row.metrics, [
          "followers_gained",
          "new_followers",
          "subscribers_gained",
          "new_subscribers",
        ]) ??
        (row.attributed_followers === null
          ? 0
          : Number(row.attributed_followers));
      return result;
    },
    { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, followers: 0 },
  );
  const engagementActions =
    totals.likes + totals.comments + totals.shares + totals.saves;
  return {
    ...totals,
    engagementActions,
    engagementRate: totals.views
      ? (engagementActions / totals.views) * 100
      : null,
    followerRate: totals.views ? (totals.followers / totals.views) * 100 : null,
    websiteRate: null,
  };
}

function platformResult(row: WeeklyRow): WeeklyPlatformResult {
  const viewKeys = viewMetricKeys(row.platform);
  return {
    platform: row.platform,
    capturedAt: row.captured_at,
    website: null,
    reposts: valueFrom(row.metrics, [
      "reposts",
      "repost_count",
      "repost",
      "retweets",
      "retweet_count",
    ]),
    shares: valueFrom(row.metrics, ["shares", "share_count"]),
    followers:
      valueFrom(row.metrics, [
        "followers_gained",
        "new_followers",
        "subscribers_gained",
        "new_subscribers",
      ]) ??
      (row.attributed_followers === null
        ? null
        : Number(row.attributed_followers)),
    completionRate:
      row.platform === "tiktok"
        ? (storedTikTokRetention(row.metrics)?.completionRate ?? null)
        : null,
    retentionScore: tiktokRetentionScore(row.platform, row.metrics),
    averageViewPercentage:
      row.platform === "youtube"
        ? valueFrom(row.metrics, [
            "average_view_percentage",
            "avg_view_percentage",
          ])
        : null,
    saves: valueFrom(row.metrics, [
      "saves",
      "favorites",
      "favorite_count",
      "bookmarks",
    ]),
    comments: valueFrom(row.metrics, ["comments", "comment_count", "replies"]),
    views: valueFrom(row.metrics, viewKeys),
    likes: valueFrom(row.metrics, ["likes", "like_count", "reactions"]),
  };
}

export function singaporeWeekWindow(now = new Date()) {
  const singaporeOffset = 8 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + singaporeOffset);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - daysSinceMonday);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() - singaporeOffset);
  return { start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) };
}

export async function getWeeklyReportData(
  selected = new Date(),
  now = new Date(),
  snapshot = true,
) {
  const period = singaporeWeekWindow(selected);
  const historical = period.end.getTime() <= now.getTime();
  const cutoff = historical && snapshot ? period.end : now;
  const result = await query<WeeklyRow>(
    `SELECT u.id::text upload_id,u.title,u.created_at,u.video_duration_seconds,u.uploader_open_id,u.uploader_name,mu.avatar_url,p.platform,latest.metrics,latest.captured_at,
    (SELECT sum(a.attributed_followers)::double precision FROM publication_follower_attributions a JOIN profile_metric_snapshots ps ON ps.id=a.profile_snapshot_id WHERE a.publication_id=p.id AND ps.captured_at < $3 AND a.created_at < $3) attributed_followers
    FROM uploads u JOIN publications p ON p.upload_id=u.id
    LEFT JOIN meedoo_users mu ON mu.open_id=u.uploader_open_id
    LEFT JOIN LATERAL (SELECT metrics,captured_at FROM metric_snapshots ms WHERE ms.publication_id=p.id AND ms.captured_at < $3 ORDER BY captured_at DESC,id DESC LIMIT 1) latest ON true
    WHERE u.review_status='approved' AND u.removed_at IS NULL AND p.removed_at IS NULL
      AND u.created_at >= $1 AND u.created_at < $2
    ORDER BY u.created_at DESC`,
    [
      period.start.toISOString(),
      period.end.toISOString(),
      cutoff.toISOString(),
    ],
  );

  const memberRows = new Map<string, WeeklyRow[]>();
  for (const row of result.rows) {
    const key =
      row.uploader_open_id ?? `name:${row.uploader_name ?? "historical"}`;
    memberRows.set(key, [...(memberRows.get(key) ?? []), row]);
  }
  const members = [...memberRows.entries()]
    .map(([id, rows]) => ({
      id,
      name: rows[0].uploader_name ?? "Historical import",
      avatar: rows[0].avatar_url,
      videoCount: new Set(rows.map((row) => row.upload_id)).size,
      conversions: summarize(rows),
    }))
    .sort(
      (left, right) =>
        right.conversions.engagementActions -
        left.conversions.engagementActions,
    );

  const uploadRows = new Map<string, WeeklyRow[]>();
  for (const row of result.rows)
    uploadRows.set(row.upload_id, [
      ...(uploadRows.get(row.upload_id) ?? []),
      row,
    ]);
  const videos = [...uploadRows.values()]
    .map((rows) => ({
      id: rows[0].upload_id,
      title: rows[0].title,
      ownerId:
        rows[0].uploader_open_id ??
        `name:${rows[0].uploader_name ?? "historical"}`,
      owner: rows[0].uploader_name ?? "Historical import",
      avatar: rows[0].avatar_url,
      createdAt: rows[0].created_at,
      duration:
        rows[0].video_duration_seconds === null
          ? null
          : Number(rows[0].video_duration_seconds),
      platforms: rows.map(platformResult),
    }))
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );

  return {
    historical,
    cutoff: cutoff.toISOString(),
    missingSnapshots: result.rows.filter((row) => !row.captured_at).length,
    updatedAt: now.toISOString(),
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      timeZone: "Asia/Singapore",
    },
    videoCount: new Set(result.rows.map((row) => row.upload_id)).size,
    conversions: summarize(result.rows),
    members,
    videos,
  };
}

export function parseReportWeek(value: string | null, now = new Date()) {
  if (value === null) return now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_WEEK");
  const date = new Date(`${value}T00:00:00+08:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    new Date(date.getTime() + 28800000).toISOString().slice(0, 10) !== value ||
    date.getTime() < Date.parse("2000-01-01T00:00:00+08:00") ||
    singaporeWeekWindow(date).start > singaporeWeekWindow(now).start
  )
    throw new Error("INVALID_WEEK");
  return date;
}
