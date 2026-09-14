import { NextRequest, NextResponse } from "next/server";
import { isApprover } from "../../../../lib/approvals";
import { getCurrentUser } from "../../../../lib/server-auth";
import { getLibTvAccounting, importLibTvCsv } from "../../../../lib/libtv-accounting";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  try {
    return NextResponse.json({ success: true, canUpload: await isApprover(user.openId), ...await getLibTvAccounting(request.nextUrl.searchParams.get("week")) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("LIBTV accounting query failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ success: false, message: "Accounting is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  if (!await isApprover(user.openId)) return NextResponse.json({ success: false, message: "Approver access required." }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const packagePoints = Number(form.get("packagePoints") ?? 16300);
    const packageCostCny = Number(form.get("packageCostCny") ?? 649);
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) return NextResponse.json({ success: false, message: "A LIBTV CSV file is required." }, { status: 400 });
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) return NextResponse.json({ success: false, message: "CSV size must be between 1 byte and 5 MB." }, { status: 400 });
    if (!Number.isInteger(packagePoints) || packagePoints <= 0 || !Number.isFinite(packageCostCny) || packageCostCny <= 0) return NextResponse.json({ success: false, message: "Valid package points and cost are required." }, { status: 400 });
    const result = await importLibTvCsv({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, packagePoints, packageCostCny, user });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    console.error("LIBTV CSV import failed", code);
    const invalid = code.startsWith("CSV_");
    return NextResponse.json({ success: false, message: invalid ? code : "LIBTV import failed." }, { status: invalid ? 400 : 500 });
  }
}
