# MiniMax video generation

`/generate` is the bilingual H3 creation page within Video workflow. Shared credentials are server-only: `MINIMAX_API_KEY` in `/etc/meedoo/meedoo.env`, API origin fixed to `https://api.minimax.cn`. Never add a browser API-key field or expose this key in responses/logs.

The original reference page is https://minimax-video-studio.a1173657596.chatgpt.site/ . Integrated inputs: up to nine reference images, first frame with optional last frame, prompt, 4–15 seconds, aspect ratio, 768P/2K. In first/last-frame mode the provider determines aspect ratio from the image. Images are uploaded separately (30 MB each), validated with ffprobe, stored privately, and supplied to MiniMax through 24-hour signed image URLs. The public image exception is scoped to generation assets, not arbitrary files or videos.

## Ownership, accounting and reliability

- `generation_assets` and `generation_tasks` are additive tables initialized by `generationSchema()`. Tasks bind the signed-in Lark user, requirement, immutable request parameters, unique client request UUID, provider task ID and price snapshot. Members see their records; approvers can view the team. Provider tasks created outside Backstage are not automatically attributed.
- Three concurrent/unresolved submissions per user. Unique `(owner_id,request_id)` and an advisory transaction lock prevent duplicate submissions. Different inputs cannot reuse an existing key. Timeout/5xx/unknown responses remain `submitted_unknown` and must be reconciled by an administrator before another paid submission; the server never automatically retries creation. A process crash with a stale `submitting` row is marked uncertain by scheduled sync.
- Usage fields are stored exactly when valid and present. Missing token fields stay missing, never zero. Video token fields, when returned, may be converted from media usage rather than text prompt tokenization. Each query updates the existing task, so polling does not add usage twice.
- China H3 list-price estimate snapshot `cn-2026-09-16`: 768P ¥0.50/s, 2K ¥0.80/s; input images above five add ¥0.20 each. Price snapshots remain server-side; the generation UI does not display estimated costs; no change to LIBTV accounting. Internal cost totals sum successful tasks only; visible usage summaries explicitly count successful tasks without token data.
- Output media is downloaded server-side, size-limited, probed, and retained in `MEEDOO_MEDIA_DIR/generation`. Downloads and previews require owner/approver authentication and support byte ranges. Only approved MiniMax/Hailuo HTTPS CDN domains and the verified China output host `algeng-video-infer.oss-cn-shanghai.aliyuncs.com` can be fetched; other Aliyun buckets are not allowed. Unsupported CDN destinations remain pending for review, not fetched through an unrestricted proxy.
- Each saved generation record has a direct authenticated download link. Records appear before completion, but downloads only become available after server storage succeeds. The output can be downloaded, then submitted through the existing upload/approval workflow. Generation never publishes to social platforms or bypasses review. Existing upload format/aspect-ratio requirements remain in effect.

## Background sync

Install `deploy/meedoo-generation.service` and `.timer` in `/etc/systemd/system`, verify the absolute Node executable in `ExecStart`, then enable/start the timer after building and deploying. This is separate from Analytics sync. The loopback `/api/generation/sync` endpoint requires `CRON_SECRET`. The timer refreshes at most five oldest pending tasks per invocation, and cannot overlap itself. Per-task advisory locks also prevent duplicate polling/downloads across the UI and timer.

The UI polls active tasks every 15 seconds while visible. Closing the browser does not abandon a task: the timer continues. Provider queries cover only seven days, so durable DB history and prompt output downloads are essential. Monitor tasks with missing files or `submitted_unknown`; do not treat these as refunded or as zero cost. Assets and completed outputs currently have no automatic deletion policy.

## Validation

`node scripts/verify-generation.cjs` checks server validation, mutually exclusive input modes, pricing and missing-usage handling. Integration checks should use isolated DB fixtures and a mocked provider; do not create paid video tasks merely to validate UI/auth/schema. Real-provider smoke tests require a deliberate test prompt and budget. Authentication may be verified using the read-only list endpoint without generating a video.

Official references: [Create](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create), [Query](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query), [Pricing](https://platform.minimax.cn/docs/guides/pricing-paygo).
