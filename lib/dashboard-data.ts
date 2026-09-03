import { query } from "./db";

export const metricDefinitions = [
  { key: "views", zh: "浏览 / 触达", en: "Views / Reach", weight: 6 },
  { key: "likes", zh: "点赞", en: "Likes", weight: 3 },
  { key: "retention", zh: "观看 / 留存", en: "Watch / Retention", weight: 17 },
  { key: "shares", zh: "分享 / 转发 / 发送", en: "Shares / Reposts / Sends", weight: 40 },
  { key: "followers", zh: "估算新增粉丝 / 订阅", en: "Estimated new followers / Subscribers", weight: 18 },
  { key: "saves", zh: "收藏", en: "Saves", weight: 10 },
  { key: "comments", zh: "评论", en: "Comments", weight: 6 },
] as const;

const platforms = ["tiktok", "instagram", "youtube"] as const;
type MetricKey = typeof metricDefinitions[number]["key"];
type Metrics = Record<MetricKey, number | null>;

type Row = {
  publication_id: string;
  upload_id: string;
  title: string;
  uploader_open_id: string | null;
  uploader_name: string | null;
  created_at: string;
  status: string;
  platform: string;
  post_url: string | null;
  platform_post_id: string | null;
  publication_status: string;
  error_message: string | null;
  metrics: Record<string, unknown> | null;
  attributed_followers: number | string | null;
  avatar_url: string | null;
  role: string | null;
};

type SnapshotRow = Row & {
  captured_at: string;
  is_seed: boolean;
};

const aliases: Record<Exclude<MetricKey, "views">, string[]> = {
  likes: ["likes", "like_count"],
  retention: ["average_view_percentage", "avg_view_percentage", "retention_rate"],
  shares: ["shares", "share_count"],
  followers: ["followers_gained", "new_followers", "subscribers_gained", "new_subscribers"],
  saves: ["saves", "favorites", "favorite_count", "bookmarks"],
  comments: ["comments", "comment_count", "replies"],
};

function emptyMetrics(): Metrics {
  return Object.fromEntries(metricDefinitions.map(({ key }) => [key, null])) as Metrics;
}

function numberFrom(metrics: Record<string, unknown> | null, keys: string[]) {
  if (!metrics) return null;
  for (const key of keys) {
    const value = metrics[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalize(row: Row): Metrics {
  const viewKeys = row.platform === "instagram" ? ["reach", "views", "impressions"] : ["views", "reach", "impressions"];
  return Object.fromEntries(metricDefinitions.map(({ key }) => [
    key,
    key === "views" ? numberFrom(row.metrics, viewKeys) : key === "followers"
      ? numberFrom(row.metrics, aliases.followers) ?? (row.attributed_followers === null ? null : Number(row.attributed_followers))
      : key === "shares" ? sumAvailable(
        numberFrom(row.metrics, aliases.shares),
        numberFrom(row.metrics, ["reposts", "repost_count", "repost"]),
      )
      : numberFrom(row.metrics, aliases[key]),
  ])) as Metrics;
}

function sumAvailable(...values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

function aggregate(rows: Row[]) {
  const normalized = rows.map((row) => ({ metrics: normalize(row) }));
  const metrics = emptyMetrics();
  for (const definition of metricDefinitions) {
    const values = normalized.map((item) => item.metrics[definition.key]).filter((value): value is number => value !== null);
    if (!values.length) continue;
    if (definition.key === "retention") {
      const weighted = normalized
        .map((item) => ({ retention: item.metrics.retention, views: item.metrics.views }))
        .filter((item): item is { retention: number; views: number } => item.retention !== null && item.views !== null && item.views > 0);
      metrics.retention = weighted.length
        ? weighted.reduce((sum, item) => sum + item.retention * item.views, 0) / weighted.reduce((sum, item) => sum + item.views, 0)
        : values.reduce((sum, value) => sum + value, 0) / values.length;
    } else {
      metrics[definition.key] = values.reduce((sum, value) => sum + value, 0);
    }
  }
  const engagementValues = [metrics.likes, metrics.comments, metrics.shares, metrics.saves]
    .filter((value): value is number => value !== null);
  const engagementRate = metrics.views && engagementValues.length
    ? engagementValues.reduce((sum, value) => sum + value, 0) / metrics.views * 100
    : null;
  const platformViews = platforms.map((platform) => rows
    .filter((row) => row.platform === platform)
    .map(normalize)
    .reduce((sum, item) => sum + (item.views ?? 0), 0));
  const platformTotal = platformViews.reduce((sum, value) => sum + value, 0);
  return {
    metrics,
    engagementRate,
    mix: platformViews.map((value) => platformTotal ? value / platformTotal * 100 : 0),
  };
}

function byPlatform(rows: Row[]) {
  return Object.fromEntries(platforms.map((platform) => {
    const platformRows = rows.filter((row) => row.platform === platform);
    return [platform, {
      ...aggregate(platformRows),
      videoCount: new Set(platformRows.map((row) => row.upload_id)).size,
    }];
  }));
}

function minuteBucket(value: string) {
  const date = new Date(value);
  date.setSeconds(0, 0);
  return date.toISOString();
}

function downsample<T>(items: T[], maximum = 240) {
  if (items.length <= maximum) return items;
  const sampled: T[] = [];
  for (let index = 0; index < maximum; index++) sampled.push(items[Math.round(index * (items.length - 1) / (maximum - 1))]);
  return sampled;
}

function buildTrend(snapshotRows: SnapshotRow[], currentRows: Row[], updatedAt: string, maximum = 240) {
  const state = new Map<string, Row>();
  for (const row of snapshotRows.filter((item) => item.is_seed)) state.set(row.publication_id, row);
  const buckets = new Map<string, SnapshotRow[]>();
  for (const row of snapshotRows.filter((item) => !item.is_seed)) {
    const bucket = minuteBucket(row.captured_at);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), row]);
  }
  const points = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([capturedAt, rows]) => {
    for (const row of rows) state.set(row.publication_id, row);
    return { capturedAt, platforms: byPlatform([...state.values()]) };
  });
  points.push({ capturedAt: updatedAt, platforms: byPlatform(currentRows) });
  const unique = points.filter((point, index) => index === points.length - 1 || point.capturedAt !== points[index + 1].capturedAt);
  return downsample(unique, maximum);
}

function singaporeDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function buildDailyViewsTrend(points: ReturnType<typeof buildTrend>, days: number, updatedAt: string) {
  if (!points.length) return [];
  const groups = new Map<string, typeof points>();
  for (const point of points) {
    const key = singaporeDay(point.capturedAt);
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const today = singaporeDay(updatedAt);
  let previous = Object.fromEntries(platforms.map((platform) => [platform, groups.values().next().value?.[0]?.platforms[platform].metrics.views ?? null])) as Record<typeof platforms[number], number | null>;
  const result: typeof points = [];
  for (const [day, dayPoints] of groups) {
    const baseline = { ...previous };
    const selected = days === 1 ? day === today ? dayPoints : [] : [dayPoints.at(-1)!];
    for (const point of selected) {
      const adjusted = Object.fromEntries(platforms.map((platform) => {
        const aggregate = point.platforms[platform];
        const current = aggregate.metrics.views;
        const dailyViews = current === null ? null : Math.max(0, current - (baseline[platform] ?? 0));
        return [platform, { ...aggregate, metrics: { ...aggregate.metrics, views: dailyViews } }];
      })) as typeof point.platforms;
      result.push({ ...point, platforms: adjusted });
    }
    const last = dayPoints.at(-1)!;
    previous = Object.fromEntries(platforms.map((platform) => [platform, last.platforms[platform].metrics.views])) as typeof previous;
  }
  return result;
}

export async function getDashboardData(days = 30) {
  const safeDays = Math.min(365, Math.max(1, Math.round(days)));
  const current = await query<Row>(`SELECT p.id::text publication_id,u.id upload_id,u.title,u.uploader_open_id,u.uploader_name,u.created_at,u.status,
    p.platform,p.post_url,p.platform_post_id,p.status publication_status,p.error_message,latest.metrics,
    (SELECT sum(a.attributed_followers)::double precision FROM publication_follower_attributions a WHERE a.publication_id=p.id) attributed_followers,
    mu.avatar_url,mu.role
    FROM uploads u JOIN publications p ON p.upload_id=u.id
    LEFT JOIN meedoo_users mu ON mu.open_id=u.uploader_open_id
    LEFT JOIN LATERAL (SELECT metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id ORDER BY captured_at DESC LIMIT 1) latest ON true
    WHERE u.review_status='approved' AND u.removed_at IS NULL AND p.removed_at IS NULL ORDER BY u.created_at DESC`);
  const allRows = current.rows;
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const rows = allRows.filter((row) => Date.parse(row.created_at) >= cutoff);

  const snapshots = await query<SnapshotRow>(`WITH eligible AS (
      SELECT p.id publication_id,u.id upload_id,u.title,u.uploader_open_id,u.uploader_name,u.created_at,u.status,
        p.platform,p.post_url,p.platform_post_id,p.status publication_status,p.error_message,mu.avatar_url,mu.role
      FROM uploads u JOIN publications p ON p.upload_id=u.id
      LEFT JOIN meedoo_users mu ON mu.open_id=u.uploader_open_id
      WHERE u.review_status='approved' AND u.removed_at IS NULL AND p.removed_at IS NULL
    ), seed AS (
      SELECT DISTINCT ON (e.publication_id) e.publication_id::text,e.upload_id,e.title,e.uploader_open_id,e.uploader_name,e.created_at,e.status,
        e.platform,e.post_url,e.platform_post_id,e.publication_status,e.error_message,ms.metrics,
        (SELECT sum(a.attributed_followers)::double precision FROM publication_follower_attributions a JOIN profile_metric_snapshots ps ON ps.id=a.profile_snapshot_id WHERE a.publication_id=e.publication_id AND ps.captured_at<=ms.captured_at) attributed_followers,
        e.avatar_url,e.role,ms.captured_at,true is_seed
      FROM eligible e JOIN metric_snapshots ms ON ms.publication_id=e.publication_id
      WHERE ms.captured_at < now() - ($1::text || ' days')::interval
      ORDER BY e.publication_id,ms.captured_at DESC
    ), timeline AS (
      SELECT e.publication_id::text,e.upload_id,e.title,e.uploader_open_id,e.uploader_name,e.created_at,e.status,
        e.platform,e.post_url,e.platform_post_id,e.publication_status,e.error_message,ms.metrics,
        (SELECT sum(a.attributed_followers)::double precision FROM publication_follower_attributions a JOIN profile_metric_snapshots ps ON ps.id=a.profile_snapshot_id WHERE a.publication_id=e.publication_id AND ps.captured_at<=ms.captured_at) attributed_followers,
        e.avatar_url,e.role,ms.captured_at,false is_seed
      FROM eligible e JOIN metric_snapshots ms ON ms.publication_id=e.publication_id
      WHERE ms.captured_at >= now() - ($1::text || ' days')::interval
    ) SELECT * FROM seed UNION ALL SELECT * FROM timeline ORDER BY captured_at`, [safeDays]);

  const updatedAt = new Date().toISOString();
  const cumulativeTrend = buildTrend(snapshots.rows, allRows, updatedAt, safeDays * 96 + 10);
  const teamTrend = downsample(cumulativeTrend);
  const dailyViewsTrend = buildDailyViewsTrend(cumulativeTrend, safeDays, updatedAt);
  const teamAggregate = aggregate(rows);
  const memberGroups = new Map<string, Row[]>();
  for (const row of rows) if (row.uploader_open_id) memberGroups.set(row.uploader_open_id, [...(memberGroups.get(row.uploader_open_id) ?? []), row]);
  const rawPeople = [...memberGroups].map(([id, personRows]) => {
    const data = aggregate(personRows);
    const first = personRows[0];
    return { id, name: first.uploader_name ?? "Lark user", role: first.role ?? "member", avatar: first.avatar_url,
      videoCount: new Set(personRows.map((row) => row.upload_id)).size, ...data };
  });
  const maxima = Object.fromEntries(metricDefinitions.map(({ key }) => [key, Math.max(0, ...rawPeople.map((person) => person.metrics[key] ?? 0))])) as Record<MetricKey, number>;
  const people = rawPeople.map((person) => {
    const ratios = Object.fromEntries(metricDefinitions.map(({ key }) => [key, person.metrics[key] === null || !maxima[key] ? null : person.metrics[key]! / maxima[key] * 100])) as Metrics;
    const scores = Object.fromEntries(metricDefinitions.map(({ key, weight }) => [key, ratios[key] === null ? null : ratios[key]! / 100 * weight])) as Metrics;
    return { ...person, ratios, scores, totalScore: Object.values(scores).reduce<number>((sum, value) => sum + (value ?? 0), 0) };
  }).sort((left, right) => right.totalScore - left.totalScore);

  const groupedVideos = new Map<string, Row[]>();
  for (const row of rows) groupedVideos.set(row.upload_id, [...(groupedVideos.get(row.upload_id) ?? []), row]);
  const videos = [...groupedVideos.values()].map((videoRows) => {
    const first = videoRows[0];
    return { id: first.upload_id, title: first.title, ownerId: first.uploader_open_id, owner: first.uploader_name ?? "Historical import",
      createdAt: first.created_at, status: first.status,
      platforms: videoRows.map((row) => ({ platform: row.platform, url: row.post_url, postId: row.platform_post_id, status: row.publication_status, error: row.error_message })),
      metrics: aggregate(videoRows).metrics };
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return {
    updatedAt, days: safeDays, metricDefinitions,
    team: { ...teamAggregate, videoCount: new Set(rows.map((row) => row.upload_id)).size, newFollowers: teamAggregate.metrics.followers,
      byPlatform: byPlatform(rows), trend: teamTrend, dailyViewsTrend },
    people, videos,
    leaderboard: { overall: people.map((person) => person.id),
      byMetric: Object.fromEntries(metricDefinitions.map(({ key }) => [key, [...people].sort((left, right) => (right.metrics[key] ?? -1) - (left.metrics[key] ?? -1)).map((person) => person.id)])) },
  };
}
