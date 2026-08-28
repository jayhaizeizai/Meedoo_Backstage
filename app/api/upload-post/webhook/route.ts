import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createNotification } from "../../../../lib/notifications";
import { query, transaction } from "../../../../lib/db";

export const runtime="nodejs";

function validSignature(raw:string,signature:string|null,timestamp:string|null) {
  const secret=process.env.UPLOAD_POST_WEBHOOK_SECRET;
  if(!secret||!signature||!timestamp||Math.abs(Date.now()/1000-Number(timestamp))>300) return false;
  const supplied=signature.replace(/^sha256=/,"");
  const expected=createHmac("sha256",secret).update(`${timestamp}.${raw}`).digest("hex");
  const a=Buffer.from(supplied,"hex"),b=Buffer.from(expected,"hex");
  return a.length===b.length&&timingSafeEqual(a,b);
}

export async function POST(request:NextRequest) {
  const raw=await request.text();
  const timestamp=request.headers.get("x-upload-post-timestamp");
  if(!validSignature(raw,request.headers.get("x-upload-post-signature"),timestamp)) return NextResponse.json({success:false,message:"Invalid signature."},{status:401});
  const deliveryId=request.headers.get("x-upload-post-delivery");
  const event=request.headers.get("x-upload-post-event") ?? "unknown";
  if(!deliveryId) return NextResponse.json({success:false,message:"Missing delivery ID."},{status:400});
  let payload:Record<string,unknown>;
  try{payload=JSON.parse(raw) as Record<string,unknown>;}catch{return NextResponse.json({success:false,message:"Invalid JSON."},{status:400});}
  const inserted=await query(`INSERT INTO webhook_deliveries(delivery_id,event,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,[deliveryId,event,raw]);
  if(!inserted.rowCount) return NextResponse.json({success:true,duplicate:true});
  if(event==="upload_completed"||payload.event==="upload_completed") {
    const jobId=typeof payload.job_id==="string"?payload.job_id:null;
    const platform=typeof payload.platform==="string"?payload.platform:null;
    const result=payload.result&&typeof payload.result==="object"?payload.result as Record<string,unknown>:{};
    if(jobId&&platform) {
      const changed=await transaction(async(client)=>{
        const found=await client.query<{upload_id:string;old_status:string;title:string}>(`SELECT p.upload_id,u.status old_status,u.title FROM publications p JOIN uploads u ON u.id=p.upload_id WHERE p.provider_job_id=$1 OR u.provider_job_id=$1 LIMIT 1`,[jobId]);
        if(!found.rows[0]) return null;
        const success=result.success===true;
        await client.query(`UPDATE publications SET status=$3,success=$4,post_url=COALESCE($5,post_url),platform_post_id=COALESCE($6,platform_post_id),error_message=$7,last_synced_at=now(),updated_at=now() WHERE upload_id=$1 AND platform=$2`,
          [found.rows[0].upload_id,platform,success?"completed":"failed",success,typeof result.url==="string"?result.url:null,typeof (result.post_id??result.publish_id)==="string"?result.post_id??result.publish_id:null,typeof result.error==="string"?result.error:null]);
        const counts=await client.query<{pending:string;failed:string}>(`SELECT count(*) FILTER(WHERE status NOT IN ('completed','failed')) pending,count(*) FILTER(WHERE status='failed') failed FROM publications WHERE upload_id=$1`,[found.rows[0].upload_id]);
        const next=Number(counts.rows[0].pending)?"processing":Number(counts.rows[0].failed)?"failed":"completed";
        await client.query(`UPDATE uploads SET status=$2,updated_at=now(),completed_at=CASE WHEN $2 IN ('completed','failed') THEN now() ELSE completed_at END WHERE id=$1`,[found.rows[0].upload_id,next]);
        return {...found.rows[0],next};
      });
      if(changed&&changed.old_status!==changed.next&&["completed","failed"].includes(changed.next)) await createNotification(changed.upload_id,`publish_${changed.next}`,changed.next==="completed"?`MeeDoo: “${changed.title}” publishing completed.`:`MeeDoo: “${changed.title}” publishing failed. Open MeeDoo to retry.`);
    }
  }
  return NextResponse.json({success:true});
}
