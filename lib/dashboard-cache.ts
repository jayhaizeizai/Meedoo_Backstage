import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { getDashboardData } from "./dashboard-data";

type Dashboard = Awaited<ReturnType<typeof getDashboardData>>;
const prefix = "dashboard:v4:";
const revisionKey = "dashboard:revision";
const lockId = 7241901;
export const dashboardRanges = [30, 1, 7, 90, 365] as const;
export const dashboardRefreshMs = 15 * 60_000;

declare global {
  var meedooDashboardRefresh: Promise<void> | undefined;
  var meedooDashboardLoads: Map<number, Promise<Dashboard>> | undefined;
}

async function revision(client?: PoolClient) {
  const sql =
    "SELECT value->>'revision' revision FROM maintenance_state WHERE key=$1";
  const result = client
    ? await client.query<{ revision: string }>(sql, [revisionKey])
    : await query<{ revision: string }>(sql, [revisionKey]);
  return result.rows[0]?.revision ?? "initial";
}

// Call in the same transaction as a removal/approval, so cached data cannot resurrect it.
export async function invalidateDashboardCache(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [lockId]);
  await client.query("DELETE FROM maintenance_state WHERE key LIKE $1", [
    `${prefix}%`,
  ]);
  await client.query(
    `INSERT INTO maintenance_state(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
    [revisionKey, JSON.stringify({ revision: randomUUID() })],
  );
}

export async function expireDashboardCache() {
  await transaction(invalidateDashboardCache);
}

async function saveResults(results: Dashboard[], expectedRevision: string) {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockId]);
    if ((await revision(client)) !== expectedRevision) return false;
    for (const data of results) {
      await client.query(
        `INSERT INTO maintenance_state(key,value,updated_at) VALUES($1,$2::jsonb,$3)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
        WHERE maintenance_state.updated_at<=excluded.updated_at`,
        [`${prefix}${data.days}`, JSON.stringify(data), data.updatedAt],
      );
    }
    return true;
  });
}

export async function getCachedDashboardData(days = 30): Promise<Dashboard> {
  const safeDays = Number.isFinite(days)
    ? Math.min(365, Math.max(1, Math.round(days)))
    : 30;
  // Keep arbitrary API ranges working, without accumulating unbounded cache entries.
  if (!dashboardRanges.some((range) => range === safeDays))
    return getDashboardData(safeDays);
  const result = await query<{ value: Dashboard }>(
    "SELECT value FROM maintenance_state WHERE key=$1",
    [`${prefix}${safeDays}`],
  );
  if (result.rows[0]) return result.rows[0].value;
  const loads = (global.meedooDashboardLoads ??= new Map());
  const existing = loads.get(safeDays);
  if (existing) return existing;
  const pending = (async () => {
    // Retry if a concurrent removal invalidates the data while it is being assembled.
    for (let attempt = 0; attempt < 3; attempt++) {
      const version = await revision();
      const data = await getDashboardData(safeDays);
      if (await saveResults([data], version)) return data;
    }
    throw new Error("DASHBOARD_CHANGED_DURING_REFRESH");
  })().finally(() => loads.delete(safeDays));
  loads.set(safeDays, pending);
  return pending;
}

export function refreshDashboardCache(): Promise<void> {
  global.meedooDashboardRefresh ??= (async () => {
    const version = await revision();
    const results: Dashboard[] = [];
    for (const days of dashboardRanges)
      results.push(await getDashboardData(days));
    // Publish every range together only after all builds succeed. A failure retains the prior data.
    if (!(await saveResults(results, version)))
      throw new Error("DASHBOARD_CHANGED_DURING_REFRESH");
  })().finally(() => {
    global.meedooDashboardRefresh = undefined;
  });
  return global.meedooDashboardRefresh;
}
