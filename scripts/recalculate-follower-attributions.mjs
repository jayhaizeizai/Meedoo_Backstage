import pg from "pg";

const apply = process.argv.includes("--apply-db");
if (!apply && !process.argv.includes("--dry-run")) {
  console.error("Use --dry-run or --apply-db.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

function viewsFrom(platform, metrics) {
  const keys = platform === "instagram" ? ["reach", "views", "impressions"] : ["views", "impressions", "reach"];
  for (const key of keys) {
    const parsed = Number(metrics?.[key]);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function allocations(total, weights) {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (!weights.length || total <= 0 || weightTotal <= 0) return weights.map(() => 0);
  const raw = weights.map((value) => total * value / weightTotal);
  const result = raw.map(Math.floor);
  let remainder = total - result.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - result[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < order.length && remainder > 0; index++, remainder--) result[order[index].index]++;
  return result;
}

await client.connect();
try {
  await client.query("BEGIN");
  const snapshots = await client.query(`SELECT id::text,platform,captured_at,followers::text
    FROM profile_metric_snapshots WHERE followers IS NOT NULL ORDER BY platform,captured_at,id`);
  if (apply) await client.query("DELETE FROM publication_follower_attributions");

  const previousByPlatform = new Map();
  const highByPlatform = new Map();
  const totals = new Map();
  let gainedTotal = 0;
  let attributedTotal = 0;

  for (const snapshot of snapshots.rows) {
    const followers = Number(snapshot.followers);
    const previous = previousByPlatform.get(snapshot.platform);
    const previousHigh = highByPlatform.get(snapshot.platform);
    previousByPlatform.set(snapshot.platform, snapshot);
    highByPlatform.set(snapshot.platform, previousHigh === undefined ? followers : Math.max(previousHigh, followers));
    if (!previous || previousHigh === undefined) continue;
    const gained = Math.max(0, followers - previousHigh);
    if (!gained) continue;
    gainedTotal += gained;

    const candidates = await client.query(`SELECT p.id::text publication_id,u.id::text upload_id,u.title,
        current_snapshot.metrics current_metrics,previous_snapshot.metrics previous_metrics
      FROM publications p JOIN uploads u ON u.id=p.upload_id
      LEFT JOIN LATERAL (SELECT metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id AND ms.captured_at<=$2 ORDER BY ms.captured_at DESC LIMIT 1) current_snapshot ON true
      LEFT JOIN LATERAL (SELECT metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id AND ms.captured_at<=$3 ORDER BY ms.captured_at DESC LIMIT 1) previous_snapshot ON true
      WHERE p.platform=$1 AND p.status='completed' AND p.removed_at IS NULL AND u.removed_at IS NULL AND u.review_status='approved'
        AND p.created_at<=$2 AND p.created_at>$3::timestamptz-interval '96 hours'`, [snapshot.platform, snapshot.captured_at, previous.captured_at]);
    const weights = candidates.rows.map((candidate) => Math.max(0,
      viewsFrom(snapshot.platform, candidate.current_metrics) - viewsFrom(snapshot.platform, candidate.previous_metrics)));
    const assigned = allocations(gained, weights);
    attributedTotal += assigned.reduce((sum, value) => sum + value, 0);

    for (let index = 0; index < candidates.rows.length; index++) {
      const candidate = candidates.rows[index];
      const value = assigned[index];
      const current = totals.get(candidate.upload_id) ?? { title: candidate.title, followers: 0 };
      current.followers += value;
      totals.set(candidate.upload_id, current);
      if (apply) await client.query(`INSERT INTO publication_follower_attributions(publication_id,profile_snapshot_id,attributed_followers,method)
        VALUES($1,$2,$3,'96h-incremental-view-weighted')`, [candidate.publication_id, snapshot.id, value]);
    }
  }

  if (apply) await client.query("COMMIT"); else await client.query("ROLLBACK");
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", snapshots: snapshots.rowCount, gainedTotal,
    attributedTotal, unattributedTotal: gainedTotal - attributedTotal,
    uploads: [...totals.entries()].map(([uploadId, value]) => ({ uploadId, ...value })).sort((a, b) => b.followers - a.followers) }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
