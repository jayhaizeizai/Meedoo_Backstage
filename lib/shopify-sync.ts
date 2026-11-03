import { db, ensureSchema, query } from "./db";
import { shopifyConfig, shopifyGraphql } from "./shopify-client";
import { normalizeShopifyOrder, shopifyOrdersDocument, type ShopifyOrder } from "./shopify-orders";

export async function ensureShopifySchema() {
  await ensureSchema();
  await db().query(`CREATE TABLE IF NOT EXISTS shopify_order_metrics (
    shop text NOT NULL, order_id text NOT NULL, created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL, test boolean NOT NULL, currency text NOT NULL,
    revenue numeric NOT NULL, refunds numeric NOT NULL, video_id uuid, platform text,
    PRIMARY KEY(shop, order_id));
    CREATE INDEX IF NOT EXISTS shopify_orders_created_idx ON shopify_order_metrics(shop, created_at);
    CREATE TABLE IF NOT EXISTS shopify_sync_state (
      shop text PRIMARY KEY, synced_at timestamptz NOT NULL, coverage_from timestamptz NOT NULL);`);
}

// Re-read the complete supported window so refunds and delayed attribution are refreshed.
// Commit only after every page succeeds: a failed run never publishes a partial total.
export async function syncShopify() {
  const config = shopifyConfig();
  if (!config) return { configured: false };
  await ensureShopifySchema();
  const client = await db().connect();
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(7241911) locked")).rows[0].locked;
    if (!locked) return { alreadyRunning: true };
    const now = new Date();
    // A full 59-day interval avoids the moving 60-day permission boundary mid-run.
    const start = new Date(now.getTime() - 59 * 86400000); start.setUTCHours(16, 0, 0, 0);
    if (start.getTime() > now.getTime() - 58 * 86400000) start.setUTCDate(start.getUTCDate() - 1);
    let after: string | null = null;
    const orders: ReturnType<typeof normalizeShopifyOrder>[] = [];
    let complete = false;
    for (let page = 0; page < 200; page++) {
      const data: { orders: { nodes: ShopifyOrder[]; pageInfo: {hasNextPage: boolean; endCursor: string | null} } } = await shopifyGraphql(shopifyOrdersDocument, {
        after, query: `created_at:>=${start.toISOString()} created_at:<${now.toISOString()}`,
      });
      orders.push(...data.orders.nodes.map(normalizeShopifyOrder));
      if (!data.orders.pageInfo.hasNextPage) { complete = true; break; }
      const next = data.orders.pageInfo.endCursor;
      if (!next || next === after) throw Error("SHOPIFY_INVALID_CURSOR");
      after = next;
    }
    if (!complete) throw Error("SHOPIFY_WINDOW_TOO_LARGE");
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM shopify_order_metrics WHERE shop=$1 AND created_at >= $2 AND created_at < $3", [config.shop, start, now]);
      for (const o of orders) await client.query(`INSERT INTO shopify_order_metrics
        (shop,order_id,created_at,updated_at,test,currency,revenue,refunds,video_id,platform)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(shop,order_id) DO UPDATE SET updated_at=EXCLUDED.updated_at,test=EXCLUDED.test,
        currency=EXCLUDED.currency,revenue=EXCLUDED.revenue,refunds=EXCLUDED.refunds,video_id=EXCLUDED.video_id,platform=EXCLUDED.platform`,
        [config.shop,o.id,o.createdAt,o.updatedAt,o.test,o.currency,o.revenue,o.refunds,o.videoId,o.platform]);
      await client.query(`INSERT INTO shopify_sync_state(shop,synced_at,coverage_from) VALUES($1,$2,$3)
        ON CONFLICT(shop) DO UPDATE SET synced_at=EXCLUDED.synced_at,coverage_from=EXCLUDED.coverage_from`, [config.shop,now,start]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    return { configured: true, orders: orders.length, syncedAt: now.toISOString() };
  } finally {
    let discard = false;
    if (locked) { try { await client.query("SELECT pg_advisory_unlock(7241911)"); } catch { discard = true; } }
    client.release(discard);
  }
}

export async function shopifySummary(from: string, to: string, platform: string, owner: string) {
  const config = shopifyConfig();
  if (!config) return { configured: false, rows: [] };
  await ensureShopifySchema();
  const state = (await query<{synced_at: Date; coverage_from: Date}>("SELECT * FROM shopify_sync_state WHERE shop=$1", [config.shop])).rows[0];
  if (!state) return { configured: true, ready: false, rows: [] };
  const start = new Date(`${from}T00:00:00+08:00`), end = new Date(`${to}T00:00:00+08:00`); end.setUTCDate(end.getUTCDate()+1);
  if (start < state.coverage_from) return { configured: true, ready: true, covered: false, syncedAt: state.synced_at, rows: [] };
  const result = await query(`SELECT o.currency,
      CASE WHEN u.id IS NOT NULL THEN 'organic' ELSE 'unattributed' END channel,
      u.uploader_open_id AS owner_id, m.name AS owner,
      SUM(o.revenue)::text revenue,SUM(o.refunds)::text refunds,
      SUM(o.revenue-o.refunds)::text net_revenue,COUNT(*)::int orders
    FROM shopify_order_metrics o
    LEFT JOIN uploads u ON u.id=o.video_id AND u.review_status='approved' AND o.platform=ANY(u.target_platforms)
    LEFT JOIN meedoo_users m ON m.open_id=u.uploader_open_id
    WHERE o.shop=$1 AND NOT o.test AND o.revenue>0 AND o.created_at >= $2 AND o.created_at < $3
      AND ($4='all' OR (u.id IS NOT NULL AND o.platform=$4))
      AND ($5='all' OR u.uploader_open_id=$5)
    GROUP BY o.currency,channel,u.uploader_open_id,m.name`, [config.shop,start,end,platform,owner]);
  return { configured: true, ready: true, covered: true, syncedAt: state.synced_at, rows: result.rows };
}
