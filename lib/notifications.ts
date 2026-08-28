import { getLarkConfig } from "./auth";
import { query } from "./db";

async function sendLarkText(openId: string, message: string) {
  if (process.env.LARK_NOTIFY_ENABLED !== "true") return false;
  const config = getLarkConfig();
  const tokenResponse = await fetch(`${config.apiOrigin}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }), cache: "no-store",
  });
  const tokenPayload = await tokenResponse.json() as { tenant_access_token?: string };
  if (!tokenResponse.ok || !tokenPayload.tenant_access_token) return false;
  const response = await fetch(`${config.apiOrigin}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenPayload.tenant_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ receive_id: openId, msg_type: "text", content: JSON.stringify({ text: message }) }),
  });
  return response.ok;
}

export async function createNotification(uploadId: string, kind: string, message: string) {
  const result = await query<{ id: string; user_open_id: string | null }>(`INSERT INTO notifications(user_open_id,upload_id,kind,message)
    SELECT uploader_open_id,id,$2,$3 FROM uploads WHERE id=$1 RETURNING id,user_open_id`, [uploadId,kind,message]);
  const notification = result.rows[0];
  if (!notification?.user_open_id) return;
  try {
    if (await sendLarkText(notification.user_open_id, message)) {
      await query(`UPDATE notifications SET delivered_to_lark=true WHERE id=$1`, [notification.id]);
    }
  } catch (error) {
    console.error("Lark notification failed", { uploadId, kind, error: error instanceof Error ? error.message : "unknown" });
  }
}
