import { query } from "./db";

export const metricDefinitions = [
  { key: "views", zh: "浏览 / 触达", en: "Views / Reach", weight: 6 },
  { key: "likes", zh: "点赞", en: "Likes", weight: 3 },
  { key: "retention", zh: "观看 / 留存", en: "Watch / Retention", weight: 17 },
  { key: "reposts", zh: "转发", en: "Reposts", weight: 22 },
  { key: "shares", zh: "分享 / 发送", en: "Shares / Sends", weight: 18 },
  { key: "followers", zh: "新增粉丝 / 订阅", en: "New followers / Subscribers", weight: 18 },
  { key: "saves", zh: "收藏", en: "Saves", weight: 10 },
  { key: "comments", zh: "评论", en: "Comments", weight: 6 },
] as const;

type MetricKey = typeof metricDefinitions[number]["key"];
type Metrics = Record<MetricKey, number | null>;
type Row = {
  upload_id: string; title: string; uploader_open_id: string | null; uploader_name: string | null; created_at: string;
  status: string; platform: string; post_url: string | null; platform_post_id: string | null; metrics: Record<string, unknown> | null;
  avatar_url: string | null; role: string | null;
};

const aliases: Record<Exclude<MetricKey,"views">, string[]> = {
  likes: ["likes","like_count"], retention: ["average_view_percentage","avg_view_percentage","retention_rate"],
  reposts: ["reposts","repost_count","repost"], shares: ["shares","share_count"],
  followers: ["followers_gained","new_followers","subscribers_gained","new_subscribers"],
  saves: ["saves","favorites","favorite_count","bookmarks"], comments: ["comments","comment_count","replies"],
};

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
  const viewKeys = row.platform === "instagram" ? ["reach","views","impressions"] : ["views","reach","impressions"];
  return Object.fromEntries(metricDefinitions.map(({ key }) => [key, key === "views" ? numberFrom(row.metrics, viewKeys) : numberFrom(row.metrics, aliases[key])])) as Metrics;
}

function aggregate(rows: Row[]) {
  const metrics = {} as Metrics;
  for (const definition of metricDefinitions) {
    const values = rows.map(normalize).map((item) => item[definition.key]).filter((value): value is number => value !== null);
    if (!values.length) metrics[definition.key] = null;
    else if (definition.key === "retention") {
      const weighted = rows.map((row) => ({ retention: normalize(row).retention, views: normalize(row).views }))
        .filter((item): item is { retention: number; views: number } => item.retention !== null && item.views !== null && item.views > 0);
      metrics.retention = weighted.length ? weighted.reduce((sum,item) => sum + item.retention * item.views,0) / weighted.reduce((sum,item) => sum + item.views,0) : values.reduce((a,b) => a+b,0)/values.length;
    } else metrics[definition.key] = values.reduce((sum,value) => sum + value, 0);
  }
  const views = metrics.views;
  const engagementParts = [metrics.likes,metrics.comments,metrics.shares,metrics.saves,metrics.reposts].filter((value): value is number => value !== null);
  const engagementRate = views && engagementParts.length ? engagementParts.reduce((a,b) => a+b,0) / views * 100 : null;
  const platformViews = ["tiktok","instagram","youtube"].map((platform) => rows.filter((row) => row.platform === platform).map(normalize).reduce((sum,item) => sum + (item.views ?? 0),0));
  const platformTotal = platformViews.reduce((a,b) => a+b,0);
  return { metrics, engagementRate, mix: platformViews.map((value) => platformTotal ? value/platformTotal*100 : 0) };
}

export async function getDashboardData(days = 30) {
  const safeDays = Math.min(365, Math.max(1, Math.round(days)));
  const result = await query<Row>(`SELECT u.id upload_id,u.title,u.uploader_open_id,u.uploader_name,u.created_at,u.status,
    p.platform,p.post_url,p.platform_post_id,latest.metrics,mu.avatar_url,mu.role
    FROM uploads u JOIN publications p ON p.upload_id=u.id
    LEFT JOIN meedoo_users mu ON mu.open_id=u.uploader_open_id
    LEFT JOIN LATERAL (SELECT metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id ORDER BY captured_at DESC LIMIT 1) latest ON true
    WHERE u.created_at >= now() - ($1::text || ' days')::interval ORDER BY u.created_at DESC`, [safeDays]);
  const rows = result.rows;
  const teamAggregate = aggregate(rows);
  const videoIds = new Set(rows.map((row) => row.upload_id));
  const memberGroups = new Map<string, Row[]>();
  for (const row of rows) if (row.uploader_open_id) memberGroups.set(row.uploader_open_id, [...(memberGroups.get(row.uploader_open_id) ?? []),row]);
  const rawPeople = [...memberGroups].map(([id,personRows]) => {
    const data = aggregate(personRows);
    const first = personRows[0];
    return { id,name:first.uploader_name ?? "Lark user",role:first.role ?? "member",avatar:first.avatar_url,videoCount:new Set(personRows.map((row) => row.upload_id)).size,...data };
  });
  const maxima = Object.fromEntries(metricDefinitions.map(({key}) => [key,Math.max(0,...rawPeople.map((person) => person.metrics[key] ?? 0))])) as Record<MetricKey,number>;
  const people = rawPeople.map((person) => {
    const ratios = Object.fromEntries(metricDefinitions.map(({key}) => [key,person.metrics[key] === null || !maxima[key] ? null : person.metrics[key]!/maxima[key]*100])) as Metrics;
    const scores = Object.fromEntries(metricDefinitions.map(({key,weight}) => [key,ratios[key] === null ? null : ratios[key]!/100*weight])) as Metrics;
    return {...person,ratios,scores,totalScore:Object.values(scores).reduce<number>((sum,value) => sum+(value ?? 0),0)};
  }).sort((a,b) => b.totalScore-a.totalScore);
  const groupedVideos = new Map<string,Row[]>();
  for (const row of rows) groupedVideos.set(row.upload_id,[...(groupedVideos.get(row.upload_id) ?? []),row]);
  const videos = [...groupedVideos.values()].map((videoRows) => {
    const first=videoRows[0]; const data=aggregate(videoRows);
    return {id:first.upload_id,title:first.title,owner:first.uploader_name ?? "Historical import",createdAt:first.created_at,status:first.status,
      platforms:videoRows.map((row) => ({platform:row.platform,url:row.post_url,postId:row.platform_post_id})),metrics:data.metrics};
  });
  return {
    updatedAt:new Date().toISOString(),days:safeDays,metricDefinitions,
    team:{...teamAggregate,videoCount:videoIds.size,newFollowers:teamAggregate.metrics.followers},
    people,videos,
    leaderboard:{overall:people.map((person) => person.id),byMetric:Object.fromEntries(metricDefinitions.map(({key}) => [key,[...people].sort((a,b) => (b.metrics[key] ?? -1)-(a.metrics[key] ?? -1)).map((person) => person.id)]))},
  };
}
