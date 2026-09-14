export const retentionVersion = 1;
export const retentionField = "meedoo_tiktok_retention";
export type RetentionPoint = { second: number; percentage: number };
export type TikTokRetention = {
  version: number;
  status: "complete" | "missing_curve" | "missing_duration" | "incomplete_curve" | "invalid_curve";
  duration: number | null;
  score: number | null;
  threeSecondRate: number | null;
  completionRate: number | null;
  inferredStart: boolean;
  segments: RetentionPoint[][];
};

function number(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Provider percentages are fractions of 1. Do not guess units or replace missing values with zero.
export function computeTikTokRetention(metrics: Record<string, unknown>, durationValue: unknown): TikTokRetention {
  const seconds = number(durationValue);
  const duration = seconds !== null && seconds > 0 ? seconds : null;
  const completion = number(metrics.full_video_watched_rate);
  const result: TikTokRetention = { version: retentionVersion, status: "missing_curve", duration, score: null,
    threeSecondRate: null, completionRate: completion !== null && completion >= 0 && completion <= 1 ? completion * 100 : null,
    inferredStart: false, segments: [] };
  if (!Array.isArray(metrics.retention) || !metrics.retention.length) return result;
  const bySecond = new Map<number, number>();
  for (const item of metrics.retention) {
    if (!item || typeof item !== "object") { result.status = "invalid_curve"; return result; }
    const second = number(item.second), percentage = number(item.percentage);
    if (second === null || second < 0 || percentage === null || percentage < 0 || percentage > 1
      || (bySecond.has(second) && bySecond.get(second) !== percentage)) {
      result.status = "invalid_curve"; return result;
    }
    bySecond.set(second, percentage);
  }
  const points = [...bySecond].sort((a, b) => a[0] - b[0]).map(([second, percentage]) => ({ second, percentage }));
  // A view starts at t=0. This explicit convention is shown separately from reported curve points.
  const integrationPoints = [...points];
  if (points[0].second > 0 && points[0].second <= 1) {
    result.inferredStart = true;
    integrationPoints.unshift({ second: 0, percentage: 1 });
  }
  for (const point of points) {
    const segment = result.segments.at(-1);
    if (!segment || point.second - segment.at(-1)!.second > 1.001) result.segments.push([point]);
    else segment.push(point);
  }
  if (duration !== null && duration >= 3) {
    const exact = bySecond.get(3);
    if (exact !== undefined) result.threeSecondRate = exact * 100;
    else {
      const right = points.findIndex(point => point.second > 3);
      if (right > 0 && points[right].second - points[right - 1].second <= 1.001) {
        const a = points[right - 1], b = points[right];
        result.threeSecondRate = (a.percentage + (b.percentage - a.percentage) * (3 - a.second) / (b.second - a.second)) * 100;
      }
    }
  }
  if (duration === null) { result.status = "missing_duration"; return result; }
  if (integrationPoints[0].second !== 0 || integrationPoints.at(-1)!.second < duration) {
    result.status = "incomplete_curve"; return result;
  }
  let area = 0;
  for (let i = 1; i < integrationPoints.length; i++) {
    const a = integrationPoints[i - 1], b = integrationPoints[i];
    if (a.second >= duration) break;
    if (b.second - a.second > 1.001) { result.status = "incomplete_curve"; return result; }
    const end = Math.min(duration, b.second);
    const atEnd = a.percentage + (b.percentage - a.percentage) * (end - a.second) / (b.second - a.second);
    area += (a.percentage + atEnd) / 2 * (end - a.second);
  }
  result.status = "complete";
  result.score = Math.max(0, Math.min(100, area / duration * 100));
  return result;
}

export function withTikTokRetention(metrics: Record<string, unknown>, duration: unknown) {
  return { ...metrics, [retentionField]: computeTikTokRetention(metrics, duration) };
}

// Read paths never integrate the curve; only the sync/backfill writes this derived result.
export function storedTikTokRetention(metrics: Record<string, unknown> | null): TikTokRetention | null {
  const value = metrics?.[retentionField] as TikTokRetention | undefined;
  return value?.version === retentionVersion ? value : null;
}

export function tiktokRetentionScore(platform: string, metrics: Record<string, unknown> | null) {
  if (platform !== "tiktok") return null;
  const result = storedTikTokRetention(metrics);
  return result?.status === "complete" && typeof result.score === "number" && Number.isFinite(result.score) ? result.score : null;
}
