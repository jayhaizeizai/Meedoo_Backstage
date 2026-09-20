import { transaction } from "./db";
import { uploadTitle } from "./upload-title";

type DigestRow = {
  id: string;
  title: string;
  original_filename: string | null;
  platform_content: unknown;
  uploader_name: string | null;
  review_status: string;
  review_comment: string | null;
  total: string | number;
};
const clip = (value: string, max: number) => {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};
export function approvalDigestText(rows: DigestRow[], since: Date, until: Date) {
  const date = (value: Date) => value.toLocaleString("en-GB", {
    timeZone: "Asia/Singapore", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const sections = [
    ["pending", "⏳ Pending / 待审批"],
    ["approved", "✅ Approved / 已批准"],
    ["rejected", "❌ Rejected / 已拒绝"],
  ].map(([status, label]) => {
    const items = rows.filter(row => row.review_status === status);
    const total = Number(items[0]?.total ?? 0);
    const lines = items.map((item, index) => {
      const title = clip(uploadTitle(item), 90);
      const owner = clip(item.uploader_name || "Lark user", 35);
      const reason = status === "rejected" && item.review_comment
        ? `\n   Reason / 原因: ${clip(item.review_comment, 120)}` : "";
      return `${index + 1}. ${title} — ${owner}${reason}`;
    });
    return `${label} (${total})\n${lines.length ? lines.join("\n") : "None / 无"}${total > items.length ? `\n… ${total - items.length} more / 更多请查看审批页面` : ""}`;
  });
  return `MeeDoo daily approval summary / 每日审批汇总\n${date(since)} – ${date(until)} (Singapore)\nPending: all outstanding / 待审批包含全部积压\nApproved & Rejected: results in this period / 已批准与已拒绝为本期结果\nApproved ≠ Published / 已批准不代表发布成功\n\n${sections.join("\n\n")}\n\n${process.env.APP_URL}/approvals`;
}

export async function queueApprovalDigest(date: string, until = new Date()) {
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(724190312)");
    const state = await client.query<{value: {date?: string; through?: string}}>(
      "SELECT value FROM maintenance_state WHERE key='approval_digest'",
    );
    const previous = state.rows[0]?.value;
    if (previous?.date === date) return false;
    const parsed = previous?.through ? Date.parse(previous.through) : NaN;
    const since = new Date(Number.isFinite(parsed) && parsed < until.getTime()
      ? parsed : until.getTime() - 24 * 60 * 60_000);
    const result = await client.query<DigestRow>(
      `WITH eligible AS (
        SELECT id,title,original_filename,platform_content,uploader_name,review_status,review_comment,
          count(*) OVER (PARTITION BY review_status) total,
          row_number() OVER (PARTITION BY review_status ORDER BY COALESCE(reviewed_at,submitted_at,created_at),id) position
        FROM uploads WHERE removed_at IS NULL AND (
          review_status='pending' OR (review_status IN ('approved','rejected') AND reviewed_at >= $1 AND reviewed_at < $2)
        )
      ) SELECT * FROM eligible WHERE position<=20 ORDER BY review_status,position`,
      [since.toISOString(), until.toISOString()],
    );
    let sent = false;
    if (result.rows.length) {
      const queued = await client.query(
        `INSERT INTO notifications(user_open_id,kind,message,lark_queued)
         SELECT open_id,'approval_digest',$1,true FROM meedoo_users WHERE role='approver'`,
        [approvalDigestText(result.rows, since, until)],
      );
      sent = Boolean(queued.rowCount);
    }
    await client.query(
      `INSERT INTO maintenance_state(key,value,updated_at) VALUES('approval_digest',$1::jsonb,now())
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,
      [JSON.stringify({date,through:until.toISOString(),sent})],
    );
    return sent;
  });
}
