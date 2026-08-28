import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { syncAll } from "../../../../lib/upload-post-sync";

export const maxDuration=300;
export async function POST(request:NextRequest) {
  const bearer=request.headers.get("authorization");
  const cronSecret=process.env.CRON_SECRET;
  const authorized=Boolean(cronSecret && bearer===`Bearer ${cronSecret}`) || Boolean(await getCurrentUser());
  if(!authorized) return NextResponse.json({success:false,message:"Authentication required."},{status:401});
  try{return NextResponse.json({success:true,...await syncAll()});}
  catch(error){console.error("Upload-Post sync failed",error instanceof Error?error.message:"unknown");return NextResponse.json({success:false,message:"Sync failed."},{status:502});}
}
