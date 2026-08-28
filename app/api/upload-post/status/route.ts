import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/server-auth";
import { isUploadPostConfigured, parseProviderResponse, providerMessage, uploadPostFetch } from "../../../../lib/upload-post";
import { applyStatusPayload } from "../../../../lib/upload-post-sync";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!await getCurrentUser()) return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  if (!isUploadPostConfigured()) return NextResponse.json({ success: false, message: "Upload-Post is not configured." }, { status: 503 });
  const requestId = request.nextUrl.searchParams.get("request_id") ?? "";
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(requestId)) return NextResponse.json({ success: false, message: "Invalid request ID." }, { status: 400 });

  try {
    const response = await uploadPostFetch(`/api/uploadposts/status?request_id=${encodeURIComponent(requestId)}`);
    const payload = await parseProviderResponse(response);
    if (!response.ok) return NextResponse.json({ success: false, message: providerMessage(payload, "Could not read upload status.") }, { status: response.status });
    await applyStatusPayload(requestId, payload);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Could not reach Upload-Post." }, { status: 502 });
  }
}
