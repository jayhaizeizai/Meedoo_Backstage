import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "../../../lib/dashboard-data";
import { getCurrentUser } from "../../../lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!await getCurrentUser()) return NextResponse.json({success:false,message:"Authentication required."},{status:401});
  try {
    const data=await getDashboardData(Number(request.nextUrl.searchParams.get("days") ?? 30));
    return NextResponse.json({success:true,...data},{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    console.error("Dashboard query failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({success:false,message:"Dashboard data is temporarily unavailable."},{status:503});
  }
}
