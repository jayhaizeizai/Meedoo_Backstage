import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/server-auth";
import { isApprover } from "../../../lib/approvals";
import { shopifySummary, syncShopify } from "../../../lib/shopify-sync";
import { supportedPlatforms } from "../../../lib/social-platforms";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  if (!await getCurrentUser()) return NextResponse.json({success:false},{status:401});
  const p = request.nextUrl.searchParams;
  const from = p.get("from") ?? "", to = p.get("to") ?? "";
  const platform = p.get("platform") ?? "all", owner = p.get("owner") ?? "all";
  const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  if (!validDay(from) || !validDay(to) || from > to || !(platform === "all" || supportedPlatforms.some(v=>v===platform)) || owner.length > 200) return NextResponse.json({success:false},{status:400});
  try { return NextResponse.json({success:true,...await shopifySummary(from,to,platform,owner)}, {headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({success:false,message:"Shopify data unavailable"},{status:503}); }
}
export async function POST(request: NextRequest) {
  const cron = process.env.CRON_SECRET;
  if (!(cron && request.headers.get("authorization") === `Bearer ${cron}`)) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({success:false},{status:401});
    if (!await isApprover(user.openId)) return NextResponse.json({success:false},{status:403});
  }
  try { return NextResponse.json({success:true,...await syncShopify()}); }
  catch { return NextResponse.json({success:false,message:"Shopify sync failed. Check store credentials and read_orders permission."},{status:502}); }
}
