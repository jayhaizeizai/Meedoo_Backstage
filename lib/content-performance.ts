export const performanceKeys = ["views", "averageRetention", "reposts", "shares", "saves", "comments", "likes"] as const;
export type PerformanceKey = typeof performanceKeys[number];
export type ContentPerformance = Record<PerformanceKey, number | null>;
function numberFrom(raw: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) { const v = raw?.[key]; if (v === null || v === undefined || v === "") continue; const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; if (Number.isFinite(n) && n >= 0) return n; }
  return null;
}
export function contentPerformance(platform: string, raw: Record<string, unknown> | null, duration: number | string | null): ContentPerformance {
  let averageRetention = numberFrom(raw, ["average_view_percentage", "avg_view_percentage"]);
  if (averageRetention === null && platform === "tiktok") {
    const seconds = numberFrom(raw, ["average_time_watched", "average_view_duration_seconds"]);
    if (seconds !== null && Number(duration) > 0) averageRetention = seconds / Number(duration) * 100;
  }
  return {
    views: numberFrom(raw, ["views", "view_count", "video_views"]),
    averageRetention,
    reposts: numberFrom(raw, ["reposts", "repost_count", "repost", "retweets", "retweet_count"]),
    shares: numberFrom(raw, ["shares", "share_count"]),
    saves: numberFrom(raw, ["saves", "favorites", "favorite_count", "bookmarks"]),
    comments: numberFrom(raw, ["comments", "comment_count", "replies"]),
    likes: numberFrom(raw, ["likes", "like_count", "reactions"]),
  };
}
export function aggregateContentPerformance(rows: ContentPerformance[]): ContentPerformance {
  return Object.fromEntries(performanceKeys.map(key => {
    if (key === "averageRetention") {
      const weighted = rows.filter(r => r.averageRetention !== null && r.views !== null && r.views > 0);
      const denominator = weighted.reduce((sum, r) => sum + r.views!, 0);
      return [key, denominator ? weighted.reduce((sum, r) => sum + r.averageRetention! * r.views!, 0) / denominator : null];
    }
    const available = rows.map(r => r[key]).filter((n): n is number => n !== null);
    return [key, available.length ? available.reduce((sum, n) => sum + n, 0) : null];
  })) as ContentPerformance;
}
