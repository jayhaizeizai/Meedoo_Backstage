import { getLarkConfig } from "./auth";
import { query } from "./db";

export async function sendLarkText(openId: string, message: string) {
  if (process.env.LARK_NOTIFY_ENABLED !== "true") return false;
  const config = getLarkConfig();
  const tokenResponse = await fetch(`${config.apiOrigin}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }), cache: "no-store",
  });
  const tokenPayload = await tokenResponse.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!tokenResponse.ok || !tokenPayload.tenant_access_token) {
    console.error("Lark token request failed", { status: tokenResponse.status, code: tokenPayload.code, message: tokenPayload.msg });
    return false;
  }
  const response = await fetch(`${config.apiOrigin}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenPayload.tenant_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ receive_id: openId, msg_type: "text", content: JSON.stringify({ text: message }) }),
  });
  if (!response.ok) {
    const payload=await response.json().catch(()=>({})) as {code?:number;msg?:string};
    console.error("Lark message request failed",{status:response.status,code:payload.code,message:payload.msg});
  }
  return response.ok;
}

export async function notifyUser(openId: string, uploadId: string | null, kind: string, message: string) {
  const result=await query<{id:string}>(`INSERT INTO notifications(user_open_id,upload_id,kind,message) VALUES($1,$2,$3,$4) RETURNING id`,[openId,uploadId,kind,message]);
  try { if(await sendLarkText(openId,message))await query(`UPDATE notifications SET delivered_to_lark=true WHERE id=$1`,[result.rows[0].id]); }
  catch(error){console.error("Lark notification failed",{kind,error:error instanceof Error?error.message:"unknown"});}
}

export async function notifyApprovers(uploadId: string, message: string) {
  const approvers=await query<{open_id:string}>(`SELECT open_id FROM meedoo_users WHERE role='approver'`);
  for(const approver of approvers.rows)await notifyUser(approver.open_id,uploadId,"approval_pending",message);
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
