import type { PoolClient } from "pg";
import { invalidateDashboardCache } from "./dashboard-cache";

export async function updateUploadSummary(
  client: PoolClient,
  uploadId: string,
) {
  const previous = await client.query<{ status: string; title: string }>(
    "SELECT status,title FROM uploads WHERE id=$1 FOR UPDATE",
    [uploadId],
  );
  if (!previous.rows[0]) return;
  const counts = await client.query<{ pending: string; failed: string }>(
    `SELECT count(*) FILTER(WHERE status NOT IN ('completed','failed')) pending,
    count(*) FILTER(WHERE status='failed') failed FROM publications WHERE upload_id=$1 AND removed_at IS NULL`,
    [uploadId],
  );
  const status = Number(counts.rows[0].pending)
    ? "processing"
    : Number(counts.rows[0].failed)
      ? "failed"
      : "completed";
  await client.query(
    `UPDATE uploads SET status=$2,updated_at=now(),
    completed_at=CASE WHEN $2='processing' THEN NULL ELSE COALESCE(completed_at,now()) END,
    media_delete_after=NULL WHERE id=$1`,
    [uploadId, status],
  );
  if (previous.rows[0].status !== status && status !== "processing") {
    await client.query(
      `INSERT INTO notifications(user_open_id,upload_id,kind,message,lark_queued)
      SELECT uploader_open_id,id,$2,$3,true FROM uploads WHERE id=$1`,
      [
        uploadId,
        `publish_${status}`,
        `MeeDoo: “${previous.rows[0].title}” publishing ${status}.`,
      ],
    );
  }
  await invalidateDashboardCache(client);
}
