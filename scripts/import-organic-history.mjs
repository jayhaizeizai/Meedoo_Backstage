#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PLATFORMS = ["youtube", "instagram", "tiktok"];
const UPLOAD_POST_ORIGIN = "https://api.upload-post.com";
const LARK_ORIGIN = "https://open.larksuite.com";
const DEFAULT_BASE_TABLE = "MeeDoo Video Performance";

function parseArgs(argv) {
  const args = {
    applyDb: false,
    syncLark: false,
    resetLark: false,
    fetchAnalytics: true,
    report: path.resolve("outputs", "organic-history-report.json"),
    ownerMap: null,
    defaultOwnerName: null,
    inputReport: null,
    regroupInput: false,
    from: null,
  };
  for (const value of argv) {
    if (value === "--dry-run") continue;
    if (value === "--apply-db") args.applyDb = true;
    else if (value === "--sync-lark") args.syncLark = true;
    else if (value === "--reset-lark") args.resetLark = true;
    else if (value === "--no-analytics") args.fetchAnalytics = false;
    else if (value.startsWith("--report=")) args.report = path.resolve(value.slice(9));
    else if (value.startsWith("--owner-map=")) args.ownerMap = path.resolve(value.slice(12));
    else if (value.startsWith("--default-owner-name=")) args.defaultOwnerName = value.slice(21).trim();
    else if (value.startsWith("--input-report=")) args.inputReport = path.resolve(value.slice(15));
    else if (value === "--regroup-input") args.regroupInput = true;
    else if (value.startsWith("--from=")) args.from = value.slice(7);
    else throw new Error(`Unknown option: ${value}`);
  }
  if (args.resetLark && !args.syncLark) throw new Error("--reset-lark requires --sync-lark");
  return args;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
    if (response.ok && Number(payload?.code ?? 0) === 0) return payload;
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 3000);
      continue;
    }
    const message = payload?.message ?? payload?.msg ?? payload?.error ?? `HTTP ${response.status}`;
    const error = new Error(String(message));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
}

function uploadPostHeaders() {
  return { Authorization: `Apikey ${required("UPLOAD_POST_API_KEY")}` };
}

function cleanText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#[\p{L}\p{N}_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function textTokens(value) {
  return new Set(cleanText(value).split(" ").filter((item) => item.length > 1));
}

function similarity(left, right) {
  const a = cleanText(left);
  const b = cleanText(right);
  if (!a || !b) return 0;
  if (a === b && a.length >= 8) return 1;
  if (Math.min(a.length, b.length) >= 20 && (a.includes(b) || b.includes(a))) return 0.92;
  const aa = textTokens(a);
  const bb = textTokens(b);
  const intersection = [...aa].filter((item) => bb.has(item)).length;
  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

function asIsoDate(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) && numeric > 0
    ? numeric < 10_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeMedia(platform, item) {
  return {
    platform,
    platformPostId: String(item.id ?? ""),
    caption: String(item.caption ?? "").trim(),
    mediaType: String(item.media_type ?? ""),
    mediaUrl: typeof item.media_url === "string" ? item.media_url : null,
    postUrl: typeof item.permalink === "string" ? item.permalink : null,
    thumbnailUrl: typeof item.thumbnail_url === "string" ? item.thumbnail_url : null,
    publishedAt: asIsoDate(item.timestamp),
    metrics: null,
    analyticsError: null,
  };
}

async function fetchAllMedia(platform, profile, from) {
  const rows = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ platform, user: profile, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const payload = await fetchJson(`${UPLOAD_POST_ORIGIN}/api/uploadposts/media?${query}`, { headers: uploadPostHeaders() });
    for (const item of Array.isArray(payload.media) ? payload.media : []) {
      const normalized = normalizeMedia(platform, item);
      if (normalized.platformPostId && (!from || !normalized.publishedAt || normalized.publishedAt >= from)) rows.push(normalized);
    }
    cursor = payload.pagination?.has_more ? payload.pagination?.next_cursor ?? null : null;
  } while (cursor);
  return rows;
}

async function fetchPostAnalytics(item, profile) {
  const query = new URLSearchParams({
    platform_post_id: item.platformPostId,
    platform: item.platform,
    user: profile,
  });
  try {
    const payload = await fetchJson(`${UPLOAD_POST_ORIGIN}/api/uploadposts/post-analytics?${query}`, { headers: uploadPostHeaders() });
    const platformResult = payload.platforms?.[item.platform] ?? {};
    item.metrics = platformResult.post_metrics ?? platformResult.metrics ?? null;
    item.analyticsError = platformResult.post_metrics_error ?? null;
  } catch (error) {
    item.analyticsError = error instanceof Error ? error.message : "Analytics request failed";
  }
}

function hoursBetween(left, right) {
  const a = Date.parse(left?.publishedAt ?? "");
  const b = Date.parse(right?.publishedAt ?? "");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 3_600_000 : Infinity;
}

function stableUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function titleFromCaption(caption, fallback) {
  const firstLine = String(caption ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return (firstLine || fallback).slice(0, 100);
}

function groupMedia(items) {
  const groups = [];
  const ordered = [...items].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
  for (const item of ordered) {
    let best = null;
    for (const group of groups) {
      if (group.items.some((candidate) => candidate.platform === item.platform)) continue;
      const scores = group.items.map((candidate) => ({ score: similarity(candidate.caption, item.caption), hours: hoursBetween(candidate, item) }));
      const candidate = scores.sort((a, b) => b.score - a.score)[0];
      if (!candidate || candidate.hours > 72 || candidate.score < 0.35) continue;
      if (!best || candidate.score > best.score) best = { group, ...candidate };
    }
    if (best) best.group.items.push(item);
    else groups.push({ items: [item] });
  }

  // A platform often uses a completely different caption for the same video.
  // Merge otherwise compatible groups when their publish times form a clear
  // cross-platform cluster. Never merge two rows from the same platform.
  let merged = true;
  while (merged) {
    merged = false;
    let best = null;
    for (let left = 0; left < groups.length; left++) {
      for (let right = left + 1; right < groups.length; right++) {
        const a = groups[left];
        const b = groups[right];
        if (a.items.some((item) => b.items.some((other) => other.platform === item.platform))) continue;
        const pairs = a.items.flatMap((item) => b.items.map((other) => ({
          hours: hoursBetween(item, other), score: similarity(item.caption, other.caption),
        })));
        const minHours = Math.min(...pairs.map((pair) => pair.hours));
        const maxText = Math.max(...pairs.map((pair) => pair.score));
        const oneSideIsSingleton = a.items.length === 1 || b.items.length === 1;
        const eligible = minHours <= 1 || (minHours <= 4 && (maxText >= 0.05 || oneSideIsSingleton)) || (minHours <= 72 && maxText >= 0.85);
        if (!eligible) continue;
        const score = maxText + (minHours <= 1 ? 2 : minHours <= 4 ? 0.5 : 0);
        if (!best || score > best.score) best = { left, right, score };
      }
    }
    if (best) {
      groups[best.left].items.push(...groups[best.right].items);
      groups.splice(best.right, 1);
      merged = true;
    }
  }

  return groups.map((group) => {
    group.items.sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform));
    const keySeed = group.items.map((item) => `${item.platform}:${item.platformPostId}`).sort().join("|");
    const strongestCaption = [...group.items].sort((a, b) => b.caption.length - a.caption.length)[0]?.caption ?? "";
    const canonicalTitleSource = group.items.find((item) => item.platform === "youtube")?.caption ?? strongestCaption;
    const pairScores = [];
    for (let i = 0; i < group.items.length; i++) for (let j = i + 1; j < group.items.length; j++) pairScores.push(similarity(group.items[i].caption, group.items[j].caption));
    const confidence = group.items.length === 1 ? "unmatched" : Math.min(...pairScores) >= 0.9 ? "high" : "review";
    return {
      videoKey: `organic:${createHash("sha256").update(keySeed).digest("hex").slice(0, 24)}`,
      uploadId: stableUuid(`meedoo-organic:${keySeed}`),
      title: titleFromCaption(canonicalTitleSource, `Historical ${group.items[0].platform} video`),
      caption: "",
      publishedAt: group.items.map((item) => item.publishedAt).filter(Boolean).sort()[0] ?? new Date().toISOString(),
      platforms: group.items.map((item) => item.platform),
      matchConfidence: confidence,
      owner: null,
      items: group.items,
    };
  });
}

async function loadOwnerMap(filename) {
  if (!filename) return {};
  return JSON.parse(await readFile(filename, "utf8"));
}

function applyOwnerMap(groups, ownerMap, defaultOwnerName) {
  for (const group of groups) {
    const owner = ownerMap[group.videoKey];
    if (owner && typeof owner === "object" && typeof owner.openId === "string") {
      group.owner = { openId: owner.openId, name: String(owner.name ?? "Lark user") };
    } else if (defaultOwnerName) {
      group.owner = { openId: null, name: defaultOwnerName };
    }
  }
}

async function applyDatabase(groups, profile) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 3 });
  const client = await pool.connect();
  const result = { createdUploads: 0, reusedUploads: 0, createdPublications: 0, metricSnapshots: 0, conflicts: [] };
  try {
    await client.query("BEGIN");
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS publications_platform_post_unique
      ON publications(platform,platform_post_id) WHERE platform_post_id IS NOT NULL`);
    for (const group of groups) {
      const existing = await client.query(`SELECT DISTINCT upload_id FROM publications
        WHERE (platform,platform_post_id) IN (SELECT * FROM unnest($1::text[],$2::text[]))`,
      [group.items.map((item) => item.platform), group.items.map((item) => item.platformPostId)]);
      if (existing.rows.length > 1) {
        result.conflicts.push({ videoKey: group.videoKey, uploadIds: existing.rows.map((row) => row.upload_id) });
        continue;
      }
      const uploadId = existing.rows[0]?.upload_id ?? group.uploadId;
      if (group.owner) {
        const user = group.owner.openId
          ? await client.query("SELECT open_id,name FROM meedoo_users WHERE open_id=$1", [group.owner.openId])
          : await client.query("SELECT open_id,name FROM meedoo_users WHERE lower(name)=lower($1) ORDER BY updated_at DESC", [group.owner.name]);
        if (user.rows.length !== 1) throw new Error(`Owner ${group.owner.name} must match exactly one signed-in Lark user`);
        group.owner.openId = user.rows[0].open_id;
        group.owner.name = user.rows[0].name;
      }
      if (!existing.rows[0]) {
        await client.query(`INSERT INTO uploads(id,request_id,profile_username,title,caption,uploader_open_id,uploader_name,status,target_platforms,imported,created_at,updated_at,completed_at)
          VALUES($1,NULL,$2,$3,$4,$5,$6,'completed',$7,true,$8,$8,$8)`,
        [uploadId, profile, group.title, group.caption, group.owner?.openId ?? null, group.owner?.name ?? null, group.platforms, group.publishedAt]);
        result.createdUploads++;
      } else {
        await client.query(`UPDATE uploads SET target_platforms=(SELECT ARRAY(SELECT DISTINCT unnest(target_platforms || $2::text[]))),
          uploader_open_id=COALESCE($3,uploader_open_id),uploader_name=COALESCE($4,uploader_name),updated_at=now() WHERE id=$1`,
        [uploadId, group.platforms, group.owner?.openId ?? null, group.owner?.name ?? null]);
        result.reusedUploads++;
      }
      for (const item of group.items) {
        const publication = await client.query(`INSERT INTO publications(upload_id,platform,request_id,platform_post_id,status,success,post_url,last_synced_at,created_at,updated_at)
          VALUES($1,$2,NULL,$3,'completed',true,$4,now(),$5,$5)
          ON CONFLICT(platform,platform_post_id) WHERE platform_post_id IS NOT NULL DO UPDATE SET
            post_url=COALESCE(excluded.post_url,publications.post_url),last_synced_at=now(),updated_at=now()
          RETURNING id,(xmax=0) inserted`, [uploadId,item.platform,item.platformPostId,item.postUrl,item.publishedAt ?? group.publishedAt]);
        if (publication.rows[0]?.inserted) result.createdPublications++;
        if (item.metrics && publication.rows[0]) {
          await client.query(`INSERT INTO metric_snapshots(publication_id,captured_at,metrics,source)
            VALUES($1,date_trunc('minute',now()),$2::jsonb,'upload-post-organic-import')
            ON CONFLICT(publication_id,captured_at) DO UPDATE SET metrics=excluded.metrics,source=excluded.source`,
          [publication.rows[0].id,JSON.stringify(item.metrics)]);
          result.metricSnapshots++;
        }
      }
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function tenantToken() {
  const payload = await fetchJson(`${LARK_ORIGIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: required("LARK_APP_ID"), app_secret: required("LARK_APP_SECRET") }),
  });
  if (!payload.tenant_access_token) throw new Error("Lark did not return a tenant access token");
  return payload.tenant_access_token;
}

function larkHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function larkList(token, endpoint, key = "items") {
  const rows = [];
  let pageToken = null;
  do {
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${LARK_ORIGIN}${endpoint}${separator}page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
    const payload = await fetchJson(url, { headers: larkHeaders(token) });
    rows.push(...(payload.data?.[key] ?? []));
    pageToken = payload.data?.has_more ? payload.data?.page_token ?? null : null;
  } while (pageToken);
  return rows;
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function backupLarkBase(token, appToken, reportPath) {
  const tables = await larkList(token, `/open-apis/bitable/v1/apps/${appToken}/tables`, "items");
  const backup = { appToken, capturedAt: new Date().toISOString(), tables: [] };
  for (const table of tables) {
    const tableId = table.table_id;
    const fields = await larkList(token, `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, "items");
    const records = await larkList(token, `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, "items");
    backup.tables.push({ table, fields, records });
  }
  const backupPath = reportPath.replace(/\.json$/i, "") + `.lark-backup-${Date.now()}.json`;
  await writeJson(backupPath, backup);
  return { backupPath, tables };
}

const LARK_FIELDS = [
  ["Title", 1], ["Owner", 1], ["Platform", 1], ["Platform Post ID", 1], ["Post URL", 1],
  ["Published At", 1], ["Status", 1], ["Imported", 1], ["Views", 2], ["Reach", 2],
  ["Likes", 2], ["Comments", 2], ["Shares", 2], ["Saves", 2], ["New Followers", 2],
  ["Watch Time Minutes", 2], ["Average View Duration Seconds", 2], ["Average View Percentage", 2],
  ["Last Synced At", 1],
];

async function createLarkTable(token, appToken) {
  const suffix = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const payload = await fetchJson(`${LARK_ORIGIN}/open-apis/bitable/v1/apps/${appToken}/tables`, {
    method: "POST", headers: larkHeaders(token),
    body: JSON.stringify({ table: { name: `${DEFAULT_BASE_TABLE} ${suffix}`, default_view_name: "All Videos" } }),
  });
  const tableId = payload.data?.table_id ?? payload.data?.table?.table_id;
  if (!tableId) throw new Error("Lark did not return the new table ID");
  const existingFields = await larkList(token, `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, "items");
  const primary = existingFields.find((field) => field.is_primary) ?? existingFields[0];
  if (primary) {
    await fetchJson(`${LARK_ORIGIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${primary.field_id}`, {
      method: "PUT", headers: larkHeaders(token), body: JSON.stringify({ field_name: "Video Key", type: 1 }),
    });
  }
  for (const [fieldName, type] of LARK_FIELDS) {
    await fetchJson(`${LARK_ORIGIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
      method: "POST", headers: larkHeaders(token), body: JSON.stringify({ field_name: fieldName, type }),
    });
  }
  return tableId;
}

function metric(metrics, ...names) {
  for (const name of names) if (Number.isFinite(Number(metrics?.[name]))) return Number(metrics[name]);
  return null;
}

function larkRecords(groups) {
  return groups.flatMap((group) => group.items.map((item) => {
    const values = {
      "Video Key": group.videoKey, "Title": group.title, "Owner": group.owner?.name ?? "Unassigned",
      "Platform": item.platform, "Platform Post ID": item.platformPostId, "Post URL": item.postUrl ?? "",
      "Published At": item.publishedAt ?? "", "Status": "completed", "Imported": "Yes",
      "Views": metric(item.metrics, "views", "impressions"), "Reach": metric(item.metrics, "reach"),
      "Likes": metric(item.metrics, "likes"), "Comments": metric(item.metrics, "comments"),
      "Shares": metric(item.metrics, "shares", "reposts"), "Saves": metric(item.metrics, "saves", "favorites"),
      "New Followers": metric(item.metrics, "followers", "subscribers_gained"),
      "Watch Time Minutes": metric(item.metrics, "watch_time_minutes"),
      "Average View Duration Seconds": metric(item.metrics, "average_view_duration_seconds"),
      "Average View Percentage": metric(item.metrics, "average_view_percentage"),
      "Last Synced At": new Date().toISOString(),
    };
    for (const [key, value] of Object.entries(values)) if (value === null || value === "") delete values[key];
    return { fields: values };
  }));
}

async function populateLarkTable(token, appToken, tableId, records) {
  for (let index = 0; index < records.length; index += 500) {
    await fetchJson(`${LARK_ORIGIN}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, {
      method: "POST", headers: larkHeaders(token), body: JSON.stringify({ records: records.slice(index, index + 500) }),
    });
  }
}

async function syncLarkBase(groups, reportPath, reset) {
  const appToken = required("LARK_BASE_APP_TOKEN");
  const token = await tenantToken();
  const { backupPath, tables } = await backupLarkBase(token, appToken, reportPath);
  const tableId = await createLarkTable(token, appToken);
  const records = larkRecords(groups);
  await populateLarkTable(token, appToken, tableId, records);
  if (reset) {
    for (const table of tables) {
      await fetchJson(`${LARK_ORIGIN}/open-apis/bitable/v1/apps/${appToken}/tables/${table.table_id}`, {
        method: "DELETE", headers: larkHeaders(token),
      });
    }
  }
  return { backupPath, tableId, records: records.length, removedOldTables: reset ? tables.length : 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = required("UPLOAD_POST_PROFILE");
  let allMedia;
  let groups;
  if (args.inputReport) {
    const input = JSON.parse(await readFile(args.inputReport, "utf8"));
    if (!Array.isArray(input.groups)) throw new Error("Input report does not contain groups");
    allMedia = input.groups.flatMap((group) => group.items ?? []);
    groups = args.regroupInput ? groupMedia(allMedia) : input.groups;
  } else {
    const from = args.from ? new Date(args.from).toISOString() : null;
    allMedia = (await Promise.all(PLATFORMS.map((platform) => fetchAllMedia(platform, profile, from)))).flat();
    if (args.fetchAnalytics) {
      for (const [index, item] of allMedia.entries()) {
        await fetchPostAnalytics(item, profile);
        if (index < allMedia.length - 1) await sleep(150);
      }
    }
    groups = groupMedia(allMedia);
  }
  applyOwnerMap(groups, await loadOwnerMap(args.ownerMap), args.defaultOwnerName);
  const report = {
    mode: args.applyDb || args.syncLark ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(), profile,
    counts: {
      platformPosts: allMedia.length,
      byPlatform: Object.fromEntries(PLATFORMS.map((platform) => [platform, allMedia.filter((item) => item.platform === platform).length])),
      videoGroups: groups.length,
      highConfidenceGroups: groups.filter((group) => group.matchConfidence === "high").length,
      reviewGroups: groups.filter((group) => group.matchConfidence === "review").length,
      unmatchedGroups: groups.filter((group) => group.matchConfidence === "unmatched").length,
      analyticsAvailable: allMedia.filter((item) => item.metrics).length,
      analyticsErrors: allMedia.filter((item) => item.analyticsError).length,
    },
    groups,
  };
  await writeJson(args.report, report);
  console.log(JSON.stringify({ report: args.report, ...report.counts }, null, 2));
  if (args.applyDb) console.log(JSON.stringify({ database: await applyDatabase(groups, profile) }, null, 2));
  if (args.syncLark) console.log(JSON.stringify({ lark: await syncLarkBase(groups, args.report, args.resetLark) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (error?.payload?.code) console.error(`provider_code=${error.payload.code}`);
  process.exitCode = 1;
});
