import { NextRequest, NextResponse } from "next/server";
import { transaction } from "../../../../../lib/db";
import { getCurrentUser } from "../../../../../lib/server-auth";
import { supportedPlatforms, UploadPostPlatform } from "../../../../../lib/upload-post";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, message: "Sign in required." }, { status: 401 });
  const id = (await params).id;
  const body=await request.json().catch(()=>({})) as {platform?:string};
  if(typeof body.platform==="string"&&!supportedPlatforms.includes(body.platform as UploadPostPlatform))return NextResponse.json({success:false,message:"Invalid platform."},{status:400});
  const platform:UploadPostPlatform|null=typeof body.platform==="string"?body.platform as UploadPostPlatform:null;
  try {
    const result=await transaction(async(client)=>{
      const allowed=await client.query<{id:string}>(`SELECT u.id::text FROM uploads u LEFT JOIN meedoo_users actor ON actor.open_id=$2
        WHERE u.id=$1 AND u.removed_at IS NULL AND u.review_status='approved' AND (u.uploader_open_id=$2 OR actor.role='approver') FOR UPDATE OF u`,[id,user.openId]);
      if(!allowed.rowCount)return null;
      const removed=await client.query<{platform:string}>(`UPDATE publications SET removed_at=now(),removed_by=$2,updated_at=now()
        WHERE upload_id=$1 AND removed_at IS NULL AND ($3::text IS NULL OR (platform=$3 AND status='completed')) RETURNING platform`,[id,user.openId,platform]);
      if(!removed.rowCount)return null;
      const active=await client.query(`SELECT 1 FROM publications WHERE upload_id=$1 AND removed_at IS NULL LIMIT 1`,[id]);
      if(!active.rowCount)await client.query(`UPDATE uploads SET removed_at=now(),removed_by=$2,updated_at=now() WHERE id=$1`,[id,user.openId]);
      return removed.rows.map((row)=>row.platform);
    });
    if(!result)return NextResponse.json({success:false,message:"No matching published platform can be removed."},{status:409});
    return NextResponse.json({success:true,removedPlatforms:result,platformContentUntouched:true});
  } catch { return NextResponse.json({success:false,message:"Could not remove this platform from MeeDoo."},{status:503}); }
}
