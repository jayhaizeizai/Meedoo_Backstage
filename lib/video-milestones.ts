import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { getLarkConfig } from "./auth";
import { uploadTitle } from "./upload-title";

export const VIEW_MILESTONES = [10_000, 30_000, 100_000] as const;
const PLATFORMS = ["youtube", "instagram", "tiktok"];
export type MilestoneConfig = {
  enabled: boolean;
  sendEnabled: boolean;
  chatId: string;
};
export function milestoneConfig(): MilestoneConfig {
  return {
    enabled: process.env.MEEDOO_MILESTONES_ENABLED === "true",
    sendEnabled: process.env.MEEDOO_MILESTONES_SEND_ENABLED === "true",
    chatId: process.env.MEEDOO_MILESTONES_CHAT_ID?.trim() ?? "",
  };
}

// Views only: reach, impressions and account-wide totals must never count here.
export function milestoneViews(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object") return null;
  const value = (metrics as Record<string, unknown>).views;
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

type VideoRow = {
  id: string;
  title: string;
  original_filename: string | null;
  platform_content: unknown;
  uploader_name: string | null;
  created_at: Date | string;
  platform: string;
  metrics: unknown;
  post_url: string | null;
};
export type MilestonePayload = {
  title: string;
  uploader: string;
  totalViews: number;
  platforms: Array<{
    platform: string;
    views: number | null;
    url: string | null;
  }>;
};
export function groupMilestoneVideos(rows: VideoRow[]) {
  const videos = new Map<
    string,
    { createdAt: Date; payload: MilestonePayload }
  >();
  for (const row of rows) {
    if (!PLATFORMS.includes(row.platform)) continue;
    let video = videos.get(row.id);
    if (!video) {
      video = {
        createdAt: new Date(row.created_at),
        payload: {
          title: uploadTitle(row),
          uploader: row.uploader_name?.trim() || "未知上传者",
          totalViews: 0,
          platforms: [],
        },
      };
      videos.set(row.id, video);
    }
    // Publications are unique by (upload_id, platform); also protect against duplicate input.
    if (video.payload.platforms.some((item) => item.platform === row.platform))
      continue;
    const views = milestoneViews(row.metrics);
    const url =
      row.post_url && /^https:\/\//i.test(row.post_url) ? row.post_url : null;
    video.payload.platforms.push({ platform: row.platform, views, url });
    video.payload.totalViews += views ?? 0;
  }
  return videos;
}

export function celebrationText(payload: MilestonePayload, threshold: number) {
  const n = (value: number) => value.toLocaleString("en-US");
  const names: Record<string, string> = {
    youtube: "YouTube",
    instagram: "Instagram",
    tiktok: "TikTok",
  };
  const lines = payload.platforms.map(
    (p) =>
      `${names[p.platform]}：${p.views === null ? "观看数据暂不可用" : n(p.views)}`,
  );
  const links = payload.platforms
    .filter((p) => p.url)
    .map((p) => `${names[p.platform]}：${p.url}`);
  return `🎉 视频跨平台合计观看突破 ${n(threshold)}！\n\nTitle：${payload.title}\n👏 上传者：${payload.uploader}\n👀 当前合计观看：${n(payload.totalViews)}\n${lines.join("\n")}\n\n${links.join("\n")}`;
}

export async function detectMilestones(
  client: PoolClient,
  config: MilestoneConfig,
) {
  const lock = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock(724190311) locked",
  );
  if (!lock.rows[0].locked)
    return { skipped: true, videos: 0, recorded: 0, baseline: false };
  const state = await client.query<{ value: { initializedAt: string } }>(
    "SELECT value FROM maintenance_state WHERE key='video_milestones'",
  );
  const firstRun = !state.rows[0];
  const activation = firstRun
    ? new Date()
    : new Date(state.rows[0].value.initializedAt);
  const rows =
    await client.query<VideoRow>(`SELECT u.id::text,u.title,u.original_filename,u.platform_content,
    COALESCE(NULLIF(u.uploader_name,''),owner.name) uploader_name,u.created_at,p.platform,p.post_url,latest.metrics
    FROM uploads u JOIN publications p ON p.upload_id=u.id
    LEFT JOIN meedoo_users owner ON owner.open_id=u.uploader_open_id
    LEFT JOIN LATERAL (SELECT ms.metrics FROM metric_snapshots ms WHERE ms.publication_id=p.id
      ORDER BY ms.captured_at DESC,ms.id DESC LIMIT 1) latest ON true
    WHERE u.removed_at IS NULL AND u.review_status='approved' AND p.removed_at IS NULL AND p.status='completed'
      AND p.platform IN ('youtube','instagram','tiktok')`);
  let recorded = 0;
  const videos = groupMilestoneVideos(rows.rows);
  // Muted events are consumed, never queued for a later burst when sending is enabled.
  if (!config.sendEnabled)
    await client.query(
      "UPDATE video_milestone_events SET status='muted' WHERE status='pending'",
    );
  for (const [id, video] of videos) {
    const prior = await client.query(
      "SELECT upload_id FROM video_milestone_state WHERE upload_id=$1",
      [id],
    );
    const baseline =
      firstRun || (!prior.rowCount && video.createdAt <= activation);
    const existing = await client.query<{ threshold: number }>(
      "SELECT threshold FROM video_milestone_events WHERE upload_id=$1",
      [id],
    );
    const crossed = VIEW_MILESTONES.filter(
      (t) =>
        video.payload.totalViews >= t &&
        !existing.rows.some((e) => e.threshold === t),
    );
    for (const threshold of crossed) {
      const highest = threshold === crossed[crossed.length - 1];
      const status = baseline
        ? "baseline"
        : !highest
          ? "superseded"
          : config.sendEnabled && /^oc_[a-zA-Z0-9]+$/.test(config.chatId)
            ? "pending"
            : "muted";
      const result = await client.query(
        `INSERT INTO video_milestone_events(upload_id,threshold,total_views,status,chat_id,payload,delivery_uuid)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(upload_id,threshold) DO NOTHING`,
        [
          id,
          threshold,
          video.payload.totalViews,
          status,
          config.chatId,
          JSON.stringify(video.payload),
          randomUUID(),
        ],
      );
      recorded += result.rowCount ?? 0;
      if (highest)
        await client.query(
          "UPDATE video_milestone_events SET status='superseded' WHERE upload_id=$1 AND threshold<$2 AND status='pending'",
          [id, threshold],
        );
    }
    await client.query(
      `INSERT INTO video_milestone_state(upload_id,last_total_views) VALUES($1,$2)
      ON CONFLICT(upload_id) DO UPDATE SET last_total_views=excluded.last_total_views,checked_at=now()`,
      [id, video.payload.totalViews],
    );
  }
  await client.query(
    `INSERT INTO maintenance_state(key,value,updated_at) VALUES('video_milestones',$1::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
    [
      JSON.stringify({
        initializedAt: activation.toISOString(),
        lastCheckedAt: new Date().toISOString(),
        videos: videos.size,
        sendEnabled: config.sendEnabled,
      }),
    ],
  );
  return { skipped: false, videos: videos.size, recorded, baseline: firstRun };
}

type Delivery = {
  id: string;
  threshold: number;
  payload: MilestonePayload;
  delivery_uuid: string;
  chat_id: string;
};
async function sendCelebration(event: Delivery) {
  // A second fail-closed guard at the network boundary; unrelated personal notifications are separate.
  const config = milestoneConfig();
  if (!config.enabled || !config.sendEnabled || config.chatId !== event.chat_id)
    return { status: "muted", messageId: null };
  const lark = getLarkConfig();
  const tokenResponse = await fetch(
    `${lark.apiOrigin}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ app_id: lark.appId, app_secret: lark.appSecret }),
    },
  );
  const token = (await tokenResponse.json()) as {
    code?: number;
    tenant_access_token?: string;
  };
  if (!tokenResponse.ok || token.code !== 0 || !token.tenant_access_token)
    return { status: "failed", messageId: null };
  const response = await fetch(
    `${lark.apiOrigin}/open-apis/im/v1/messages?receive_id_type=chat_id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.tenant_access_token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        receive_id: event.chat_id,
        msg_type: "text",
        uuid: event.delivery_uuid,
        content: JSON.stringify({
          text: celebrationText(event.payload, event.threshold),
        }),
      }),
    },
  );
  const result = (await response.json()) as {
    code?: number;
    data?: { message_id?: string };
  };
  return {
    status:
      response.ok && result.code === 0 && result.data?.message_id
        ? "sent"
        : "failed",
    messageId: result.data?.message_id ?? null,
  };
}

export async function syncVideoMilestones() {
  const config = milestoneConfig();
  if (!config.enabled) return { enabled: false, sendEnabled: false };
  const detection = await transaction((client) =>
    detectMilestones(client, config),
  );
  let sent = 0;
  if (config.sendEnabled && /^oc_[a-zA-Z0-9]+$/.test(config.chatId)) {
    for (let i = 0; i < 10; i++) {
      // Claim durably before network I/O. Crashed/uncertain deliveries are not automatically resent.
      const claimed = await query<Delivery>(
        `UPDATE video_milestone_events e SET status='sending',attempted_at=now()
        WHERE e.id=(SELECT v.id FROM video_milestone_events v JOIN uploads u ON u.id=v.upload_id
          WHERE v.status='pending' AND v.chat_id=$1 AND u.removed_at IS NULL AND u.review_status='approved'
          ORDER BY v.detected_at FOR UPDATE OF v SKIP LOCKED LIMIT 1)
        RETURNING e.id::text,e.threshold,e.payload,e.delivery_uuid,e.chat_id`,
        [config.chatId],
      );
      const event = claimed.rows[0];
      if (!event) break;
      let delivery: { status: string; messageId: string | null };
      try {
        delivery = await sendCelebration(event);
      } catch {
        delivery = { status: "uncertain", messageId: null };
      }
      await query(
        "UPDATE video_milestone_events SET status=$2,message_id=$3 WHERE id=$1",
        [event.id, delivery.status, delivery.messageId],
      );
      if (delivery.status === "sent") sent++;
    }
  }
  return { enabled: true, sendEnabled: config.sendEnabled, ...detection, sent };
}
