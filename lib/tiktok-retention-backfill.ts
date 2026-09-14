import { query } from "./db";
import {
  computeTikTokRetention,
  retentionField,
  retentionVersion,
} from "./tiktok-retention";

export async function backfillTikTokRetention(maxBatches = 2) {
  let updated = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await query<{
      id: string;
      metrics: Record<string, unknown>;
      duration: string | null;
    }>(
      `SELECT m.id,m.metrics,u.video_duration_seconds duration
      FROM metric_snapshots m JOIN publications p ON p.id=m.publication_id JOIN uploads u ON u.id=p.upload_id
      WHERE p.platform='tiktok' AND p.removed_at IS NULL AND u.removed_at IS NULL
      AND (m.metrics->$1->>'version' IS DISTINCT FROM $2 OR
        (u.video_duration_seconds > 0 AND (m.metrics->$1->>'duration')::numeric IS DISTINCT FROM u.video_duration_seconds)) ORDER BY m.id LIMIT 500`,
      [retentionField, String(retentionVersion)],
    );
    if (!rows.rows.length) break;
    const values = rows.rows.flatMap((row) => [
      row.id,
      JSON.stringify(computeTikTokRetention(row.metrics, row.duration)),
    ]);
    const tuples = rows.rows
      .map((_, index) => `($${index * 2 + 1}::bigint,$${index * 2 + 2}::jsonb)`)
      .join(",");
    const result = await query(
      `UPDATE metric_snapshots m SET metrics=jsonb_set(m.metrics,'{${retentionField}}',v.result)
      FROM (VALUES ${tuples}) v(id,result) WHERE m.id=v.id`,
      values,
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}
