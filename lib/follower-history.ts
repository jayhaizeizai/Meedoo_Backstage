import { query } from "./db";

type Attribution = {
  publication_id: string;
  captured_at: string | Date;
  captured_us?: string;
  followers: string | number;
};
type Snapshot = {
  publication_id: string;
  captured_at: string | Date | null;
  captured_us?: string | null;
  attributed_followers: string | number | null;
};

// Retain PostgreSQL microseconds: JavaScript Date alone truncates distinct snapshot times.
// Read each attribution once, rather than re-running a SUM/join for every metric snapshot.
export function applyFollowerHistory<T extends Snapshot>(
  snapshots: T[],
  attributions: Attribution[],
) {
  const history = new Map<string, Array<{ time: number; total: number }>>();
  for (const row of attributions) {
    let points = history.get(row.publication_id);
    if (!points) history.set(row.publication_id, (points = []));
    points.push({
      time: row.captured_us
        ? Number(row.captured_us)
        : new Date(row.captured_at).getTime() * 1000,
      total: Number(row.followers),
    });
  }
  for (const points of history.values()) {
    points.sort((a, b) => a.time - b.time);
    let total = 0;
    for (const point of points) point.total = total += point.total;
  }
  for (const row of snapshots) {
    const points = history.get(row.publication_id) ?? [];
    const cutoff =
      row.captured_at === null
        ? Infinity
        : row.captured_us
          ? Number(row.captured_us)
          : new Date(row.captured_at).getTime() * 1000;
    let left = 0,
      right = points.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (points[mid].time <= cutoff) left = mid + 1;
      else right = mid;
    }
    // Preserve SQL SUM semantics: no preceding records is null, a recorded zero is zero.
    row.attributed_followers = left ? points[left - 1].total : null;
  }
}

export async function loadFollowerHistory<T extends Snapshot>(snapshots: T[]) {
  const ids = [...new Set(snapshots.map((row) => row.publication_id))];
  if (!ids.length) return;
  const result = await query<Attribution>(
    `SELECT a.publication_id::text,ps.captured_at,(extract(epoch FROM ps.captured_at)*1000000)::bigint::text captured_us,a.attributed_followers followers
    FROM publication_follower_attributions a JOIN profile_metric_snapshots ps ON ps.id=a.profile_snapshot_id
    WHERE a.publication_id=ANY($1::bigint[])`,
    [ids],
  );
  applyFollowerHistory(snapshots, result.rows);
}
