type Metrics = Record<string, unknown> | null;

function numeric(metrics: Metrics, ...keys: string[]) {
  if (!metrics) return null;
  for (const key of keys) {
    const value = metrics[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function weightedScore(parts: Array<{ value: number | null; weight: number }>) {
  const available = parts.filter((part): part is { value: number; weight: number } => part.value !== null);
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  return weight ? available.reduce((sum, part) => sum + part.value * part.weight, 0) / weight : null;
}

export function equivalentRetention(platform: string, metrics: Metrics, durationSeconds: number | string | null) {
  if (!metrics || platform === "instagram") return null;
  if (platform === "youtube") {
    const percentage = numeric(metrics, "average_view_percentage", "avg_view_percentage");
    if (percentage === null) return null;
    const hasWatchReport = numeric(metrics, "average_view_duration_seconds", "watch_time_minutes") !== null;
    return percentage === 0 && !hasWatchReport ? null : clampScore(percentage);
  }
  if (platform === "tiktok") {
    const duration = Number(durationSeconds);
    const averageSeconds = numeric(metrics, "average_time_watched", "average_view_duration_seconds");
    const averageWatchScore = averageSeconds !== null && Number.isFinite(duration) && duration > 0
      ? clampScore(averageSeconds / duration * 100) : null;
    const completion = numeric(metrics, "full_video_watched_rate");
    const completionScore = completion === null ? null : clampScore(completion <= 1 ? completion * 100 : completion);
    return weightedScore([{ value: averageWatchScore, weight: 0.65 }, { value: completionScore, weight: 0.35 }]);
  }
  return null;
}
