import { uploadTitle } from "./upload-title";
import { getLarkConfig } from "./auth";
import { after } from "next/server";
import { query, transaction } from "./db";

let tenantToken: {value:string;expires:number} | undefined;
let tokenRequest: Promise<string> | undefined;
async function getTenantToken() {
  if (tenantToken && tenantToken.expires > Date.now()) return tenantToken.value;
  tokenRequest ??= (async () => {
    const config = getLarkConfig();
    const response = await fetch(`${config.apiOrigin}/open-apis/auth/v3/tenant_access_token/internal`, {
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({app_id:config.appId,app_secret:config.appSecret}),signal:AbortSignal.timeout(8000),cache:"no-store"
    });
    const data = await response.json();
    if (!response.ok || data.code || !data.tenant_access_token) throw new Error("LARK_TOKEN_FAILED");
    tenantToken={value:data.tenant_access_token,expires:Date.now()+Math.max(0,(Number(data.expire)||3600)-120)*1000};
    return tenantToken.value;
  })().finally(() => {tokenRequest=undefined;});
  return tokenRequest;
}
export async function sendLarkText(openId:string,message:string,notificationId?:string) {
  if (process.env.LARK_NOTIFY_ENABLED !== "true") return false;
  const token=await getTenantToken();
  const response=await fetch(`${getLarkConfig().apiOrigin}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({receive_id:openId,msg_type:"text",content:JSON.stringify({text:message}),...(notificationId?{uuid:notificationId}:{})}),signal:AbortSignal.timeout(8000)
  });
  const data=await response.json();
  if (!response.ok || data.code) {tenantToken=undefined;return false;}
  return true;
}

export async function flushNotifications() {
  if (process.env.LARK_NOTIFY_ENABLED !== "true") return;
  const deadline=Date.now()+20_000;
  for(let i=0;i<20 && Date.now()<deadline;i++) {
    const found=await transaction(async client => {
      const rows=await client.query<{id:string;user_open_id:string;message:string}>(`SELECT id,user_open_id,message FROM notifications
        WHERE lark_queued=true AND delivered_to_lark=false AND user_open_id IS NOT NULL
        AND (lark_attempted_at IS NULL OR lark_attempted_at < now()-interval '5 minutes')
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
      const item=rows.rows[0];if(!item)return false;
      await client.query("UPDATE notifications SET lark_attempted_at=now() WHERE id=$1",[item.id]);
      try {if(await sendLarkText(item.user_open_id,item.message,item.id)) await client.query("UPDATE notifications SET delivered_to_lark=true WHERE id=$1",[item.id]);}
      catch {console.error("Queued Lark delivery failed; retry scheduled");}
      return true;
    });
    if(!found)break;
  }
}
function scheduleDelivery() {
  // The DB queue survives process termination; scheduled sync also drains it.
  try {after(async()=>{try{await flushNotifications();}catch{console.error("Notification queue unavailable");}});} catch {}
}

async function withUploadTitle(uploadId: string | null, message: string) {
  if (!uploadId) return message;
  const result = await query<{title:string;original_filename:string|null;platform_content:unknown}>(
    `SELECT title,original_filename,platform_content FROM uploads WHERE id=$1`, [uploadId]);
  const record = result.rows[0];
  if (!record) return message;
  const title = uploadTitle(record);
  // Existing event messages quote the video title; generic approval messages need a title line.
  return /^MeeDoo(?: reminder)?: “[^”]*”/.test(message) ? message.replace(/“[^”]*”/, () => `“${title}”`) : `Title: ${title}\n${message}`;
}

export async function notifyUser(openId: string, uploadId: string | null, kind: string, message: string) {
  message = await withUploadTitle(uploadId, message);
  await query(`INSERT INTO notifications(user_open_id,upload_id,kind,message,lark_queued) VALUES($1,$2,$3,$4,true)`,[openId,uploadId,kind,message]);
  scheduleDelivery();
}

export async function notifyApprovers(uploadId: string, message: string) {
  const approvers=await query<{open_id:string}>(`SELECT open_id FROM meedoo_users WHERE role='approver'`);
  for(const approver of approvers.rows)await notifyUser(approver.open_id,uploadId,"approval_pending",message);
}

export async function createNotification(uploadId: string, kind: string, message: string) {
  message = await withUploadTitle(uploadId, message);
  await query(`INSERT INTO notifications(user_open_id,upload_id,kind,message,lark_queued)
    SELECT uploader_open_id,id,$2,$3,true FROM uploads WHERE id=$1`, [uploadId,kind,message]);
  scheduleDelivery();
}
