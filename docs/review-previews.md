# Approval video previews

Approval pages default to a separate H.264/AAC MP4 preview, at most 720 × 1280, 30 fps, CRF 23, capped video rate 2 Mbps, AAC 96 kbps. Faststart puts the playback index first. Original uploads and publication paths are unchanged. Reviewers can switch to the original to check fine details.

`lib/review-preview.ts` maintains a durable `review_previews` table. An independent timer discovers pending approvals; opening an older authorized approval queues its preview too. One global PostgreSQL advisory lock limits conversion to one video at a time, with two decoder/encoder threads, reduced process priority (nice 10), and a ten-minute timeout. Failed work retries up to three attempts, five minutes apart. A new worker recovers interrupted jobs. Output is promoted atomically only after source signature and record validity checks. Removed/withdrawn/deleted-source records have their preview cleaned by the worker. Preview storage uses `MEEDOO_MEDIA_DIR/review-previews-v1`; do not delete original media to clean previews.

Install ffmpeg with libx264 and AAC, then install `deploy/meedoo-review-previews.service` and `.timer` into `/etc/systemd/system`. Run `systemctl daemon-reload` and `systemctl enable --now meedoo-review-previews.timer`. The worker uses the existing local CRON_SECRET-authenticated `/api/review-previews/sync` endpoint. It never calls AI generation or publishing APIs. No additional API credentials are needed.

Preview and original URLs are pinned to separate representations, so a conversion finishing cannot mix original/preview byte ranges. Existing approver/owner authorization applies to every request. Until ready or if conversion fails, the original remains available. The page has a check-preview button that does not reset edited captions or review comments. No automatic playback switch interrupts ongoing review. Unsupported/missing preview responses fall back to the original in the player.

`parseByteRange` handles explicit, open-ended and suffix ranges, clamps the end, and returns 416 with total size when unsatisfiable. HEAD returns file metadata without a stream. Responses remain private/no-store.

Validation: `node scripts/verify-review-preview.cjs`. Deployment must also test real ffmpeg conversion, inspect codec/resolution and moov-before-mdat ordering, verify the original file hash is unchanged, and verify authenticated byte ranges against the live test API. Build and test before production.
