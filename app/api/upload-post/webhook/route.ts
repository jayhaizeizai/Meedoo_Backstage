import { updateUploadSummary } from "../../../../lib/publication-status";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { transaction } from "../../../../lib/db";

export const runtime = "nodejs";

function validSignature(
  raw: string,
  signature: string | null,
  timestamp: string | null,
) {
  const secret = process.env.UPLOAD_POST_WEBHOOK_SECRET;
  if (
    !secret ||
    !signature ||
    !timestamp ||
    !Number.isFinite(Number(timestamp)) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const supplied = signature.replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const a = Buffer.from(supplied, "hex"),
    b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const timestamp = request.headers.get("x-upload-post-timestamp");
  if (
    !validSignature(
      raw,
      request.headers.get("x-upload-post-signature"),
      timestamp,
    )
  )
    return NextResponse.json(
      { success: false, message: "Invalid signature." },
      { status: 401 },
    );
  const deliveryId = request.headers.get("x-upload-post-delivery");
  const event = request.headers.get("x-upload-post-event") ?? "unknown";
  if (!deliveryId)
    return NextResponse.json(
      { success: false, message: "Missing delivery ID." },
      { status: 400 },
    );
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON." },
      { status: 400 },
    );
  }
  try {
    const outcome = await transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO webhook_deliveries(delivery_id,event,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
        [deliveryId, event, raw],
      );
      if (!inserted.rowCount) return { duplicate: true };
      if (event !== "upload_completed" && payload.event !== "upload_completed")
        return {};
      const jobId = typeof payload.job_id === "string" ? payload.job_id : null;
      const platform =
        typeof payload.platform === "string" ? payload.platform : null;
      const result =
        payload.result && typeof payload.result === "object"
          ? (payload.result as Record<string, unknown>)
          : {};
      if (!jobId || !platform) throw new Error("MISSING_JOB_IDENTITY");
      // Only the active platform attempt may change status; an old upload-level job cannot overwrite a retry.
      const found = await client.query<{ upload_id: string; id: string }>(
        `SELECT p.upload_id,p.id FROM publications p JOIN uploads u ON u.id=p.upload_id
        WHERE p.platform=$2 AND u.removed_at IS NULL AND p.removed_at IS NULL
        AND (p.provider_job_id=$1 OR (u.provider_job_id=$1 AND p.request_id=u.request_id)) FOR UPDATE OF u`,
        [jobId, platform],
      );
      if (!found.rows[0]) throw new Error("JOB_NOT_YET_MATCHED");
      const item = found.rows[0],
        success = result.success === true;
      await client.query(
        `UPDATE publications SET status=$2,success=$3,post_url=COALESCE($4,post_url),platform_post_id=COALESCE($5,platform_post_id),
        error_message=$6,last_synced_at=now(),updated_at=now() WHERE id=$1`,
        [
          item.id,
          success ? "completed" : "failed",
          success,
          typeof result.url === "string" ? result.url : null,
          typeof (result.post_id ?? result.publish_id) === "string"
            ? (result.post_id ?? result.publish_id)
            : null,
          typeof result.error === "string" ? result.error : null,
        ],
      );
      await updateUploadSummary(client, item.upload_id);
      return {};
    });
    return NextResponse.json({ success: true, ...outcome });
  } catch {
    // No delivery marker survives a failure: provider retries can process it again.
    console.error("Webhook transaction incomplete; retry required");
    return NextResponse.json(
      { success: false, message: "Please retry this delivery." },
      { status: 503 },
    );
  }
}
