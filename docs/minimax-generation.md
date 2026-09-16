# Video generation: MiniMax and Seedance

`/generate` is the bilingual model-selectable creation page within Video workflow. Shared credentials are server-only: `MINIMAX_API_KEY` in `/etc/meedoo/meedoo.env`, API origin fixed to `https://api.minimax.cn`. Never add a browser API-key field or expose this key in responses/logs.

The original reference page is https://minimax-video-studio.a1173657596.chatgpt.site/ . Integrated inputs: up to nine reference images, first frame with optional last frame, prompt, 4–15 seconds, aspect ratio, 768P/2K. In first/last-frame mode the provider determines aspect ratio from the image. Images are uploaded separately (30 MB each), validated with ffprobe, stored privately, and supplied to MiniMax through 24-hour signed image URLs. The public image exception is scoped to generation assets, not arbitrary files or videos.

## Ownership, accounting and reliability

- `generation_assets` and `generation_tasks` are additive tables initialized by `generationSchema()`. Tasks bind the signed-in Lark user, requirement, immutable request parameters, unique client request UUID, provider task ID and price snapshot. Members see their records; approvers can view the team. Provider tasks created outside Backstage are not automatically attributed.
- Three concurrent/unresolved submissions per user. Unique `(owner_id,request_id)` and an advisory transaction lock prevent duplicate submissions. Different inputs cannot reuse an existing key. Timeout/5xx/unknown responses remain `submitted_unknown` and must be reconciled by an administrator before another paid submission; the server never automatically retries creation. A process crash with a stale `submitting` row is marked uncertain by scheduled sync.
- Usage fields are stored exactly when valid and present. Missing token fields stay missing, never zero. Video token fields, when returned, may be converted from media usage rather than text prompt tokenization. Each query updates the existing task, so polling does not add usage twice.
- China H3 list-price estimate snapshot `cn-2026-09-16`: 768P ¥0.50/s, 2K ¥0.80/s; input images above five add ¥0.20 each. Price snapshots remain server-side; the generation UI does not display estimated costs; no change to LIBTV accounting. Internal cost totals sum successful tasks only; the requirement usage summary is not displayed in the UI.
- Output media is downloaded server-side, size-limited, probed, and retained in `MEEDOO_MEDIA_DIR/generation`. Downloads and previews require owner/approver authentication and support byte ranges. Only approved MiniMax/Hailuo HTTPS CDN domains and the verified China output host `algeng-video-infer.oss-cn-shanghai.aliyuncs.com` can be fetched; other Aliyun buckets are not allowed. Unsupported CDN destinations remain pending for review, not fetched through an unrestricted proxy.
- Each saved generation record has a direct authenticated download link. Records appear before completion, but downloads only become available after server storage succeeds. The output can be downloaded, then submitted through the existing upload/approval workflow. Generation never publishes to social platforms or bypasses review. Existing upload format/aspect-ratio requirements remain in effect.

## Background sync

Install `deploy/meedoo-generation.service` and `.timer` in `/etc/systemd/system`, verify the absolute Node executable in `ExecStart`, then enable/start the timer after building and deploying. This is separate from Analytics sync. The loopback `/api/generation/sync` endpoint requires `CRON_SECRET`. The timer refreshes at most five oldest pending tasks per invocation, and cannot overlap itself. Per-task advisory locks also prevent duplicate polling/downloads across the UI and timer.

The UI polls active tasks every 15 seconds while visible. Closing the browser does not abandon a task: the timer continues. Provider queries cover only seven days, so durable DB history and prompt output downloads are essential. Monitor tasks with missing files or `submitted_unknown`; do not treat these as refunded or as zero cost. Completed output files expire 14 days after successful local storage and are deleted by the generation timer. Existing files use the recorded updated_at plus 14 days. Expired tasks retain their metadata and usage, are not downloaded again, and show File expired. Authenticated media access also enforces the deadline. Cleanup uses the same task lock as refresh and only unlinks that task’s exact generation UUID MP4 path. Reference images and videos submitted through the separate upload workflow are not deleted by this policy.

## Validation

`node scripts/verify-generation.cjs` checks server validation, mutually exclusive input modes, pricing and missing-usage handling. Integration checks should use isolated DB fixtures and a mocked provider; do not create paid video tasks merely to validate UI/auth/schema. Real-provider smoke tests require a deliberate test prompt and budget. Authentication may be verified using the read-only list endpoint without generating a video.

Official references: [Create](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create), [Query](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query), [Pricing](https://platform.minimax.cn/docs/guides/pricing-paygo).


## Seedance 2.0 / 2.5

The model picker uses `lib/generation-model.ts` as a shared capability registry. API adapters live in `lib/generation-provider.ts`; task ownership, idempotency, storage and expiry remain in `lib/generation.ts`. Legacy tasks without `input.model` remain MiniMax H3. New tasks freeze the model and audio option in `input`; changing either cannot reuse a request UUID.

- `seedance-2.0` → `doubao-seedance-2-0-260128`: 4–15 seconds, up to nine reference images.
- `seedance-2.5` → `doubao-seedance-2-5-260628`: 4–30 seconds, up to 30 reference images.
- Initial integration offers 480p/720p, text/reference images or first/last frames, and an audio toggle. Video/audio reference uploads, editing and extension are not implemented.
- Server-only `ARK_API_KEY`, fixed origin `https://ark.cn-beijing.volces.com/api/v3`. The `apikey-…` resource identifier is not a model/endpoint ID. `GET /models` and task listing verified authentication and the two model identifiers; this does not prove paid generation entitlement. No paid smoke generation has been run.
- Create: `POST /contents/generations/tasks`, response `id`. Query: `GET /contents/generations/tasks/{id}`, output `content.video_url`, usage `total_tokens` and `completion_tokens`. Returned duration is recorded as output seconds. Provider-expired tasks are terminal failures. Ambiguous submissions are never retried automatically.
- Seedance costs are NULL (not estimated), never borrowed from MiniMax prices or treated as zero. Actual reported token usage is retained. The UI has no cost or requirement-summary panel.
- CDN allowlist is provider-scoped; Ark output currently permits only `ark-acg-cn-beijing.tos-cn-beijing.volces.com`. Other hosts remain save-pending for inspection. All redirects are revalidated. Real Seedance output-host verification remains pending the first deliberate generated task.
- The same owner/approver download permissions and 14-day output cleanup apply. Reference assets and separately uploaded videos remain outside output cleanup.

Sources: [official Ark SDK](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/content_generation/tasks.py), [official response schema](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/content_generation_task.py), [Seedance 2.0 paper](https://arxiv.org/abs/2604.14148), [Seedance 2.5 announcement](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5).

`node scripts/verify-generation.cjs --db` is TEST-only and uses an isolated schema and fake provider. It verifies model routing, immutable audio/model selection, deduplication, local MP4 persistence, token accounting, legacy H3 compatibility and expiry without paid API submissions.
