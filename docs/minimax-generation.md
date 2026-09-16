# Video generation: MiniMax and Seedance

`/generate` is the bilingual model-selectable creation page within Video workflow. Shared credentials are server-only: `MINIMAX_API_KEY` in `/etc/meedoo/meedoo.env`, API origin fixed to `https://api.minimax.cn`. Never add a browser API-key field or expose this key in responses/logs.

The original reference page is https://minimax-video-studio.a1173657596.chatgpt.site/ . Integrated inputs: up to nine reference images, first frame with optional last frame, prompt, 4–15 seconds, aspect ratio, 768P/2K. In first/last-frame mode the provider determines aspect ratio from the image. Images are uploaded separately (30 MB each), validated with ffprobe, stored privately, and supplied to Seedance through 24-hour signed image URLs. MiniMax reference images are uploaded to its Files API first and referenced by mm_file IDs; see cache details below. The public image exception is scoped to generation assets, not arbitrary files or videos.

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
- `seedance-2.0-fast` → `doubao-seedance-2-0-fast-260128`: 4–15 seconds, up to nine reference images, 480p/720p.
- `seedance-2.0-mini` → `doubao-seedance-2-0-mini-260615`: 4–15 seconds, up to nine reference images, 480p/720p.
- `seedance-2.5` → `doubao-seedance-2-5-260628`: 4–30 seconds, up to 30 reference images.
- Initial integration offers 480p/720p, text/reference images or first/last frames, and an audio toggle. Video/audio reference uploads, editing and extension are not implemented.
- Server-only `ARK_API_KEY`, fixed origin `https://ark.cn-beijing.volces.com/api/v3`. The `apikey-…` resource identifier is not a model/endpoint ID. `GET /models` and task listing verified authentication and the two model identifiers; this does not prove paid generation entitlement. No paid smoke generation has been run.
- Create: `POST /contents/generations/tasks`, response `id`. Query: `GET /contents/generations/tasks/{id}`, output `content.video_url`, usage `total_tokens` and `completion_tokens`. Returned duration is recorded as output seconds. Provider-expired tasks are terminal failures. Ambiguous submissions are never retried automatically.
- Seedance costs are NULL (not estimated), never borrowed from MiniMax prices or treated as zero. Actual reported token usage is retained. The UI has no cost or requirement-summary panel.
- CDN allowlist is provider-scoped; Ark output currently permits only `ark-acg-cn-beijing.tos-cn-beijing.volces.com`. Other hosts remain save-pending for inspection. All redirects are revalidated. Real Seedance output-host verification remains pending the first deliberate generated task.
- The same owner/approver download permissions and 14-day output cleanup apply. Reference assets and separately uploaded videos remain outside output cleanup.

Sources: [official Ark SDK](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/content_generation/tasks.py), [official response schema](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/content_generation_task.py), [Seedance 2.0 paper](https://arxiv.org/abs/2604.14148), [Seedance 2.5 announcement](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5).

`node scripts/verify-generation.cjs --db` is TEST-only and uses an isolated schema and fake provider. It verifies model routing, immutable audio/model selection, deduplication, local MP4 persistence, token accounting, legacy H3 compatibility and expiry without paid API submissions.


## MiniMax reference image cache (media URL reachability fix)

Repeated production H3 tasks returned error 2013: `content[3/4].image_url: media url unreachable`. The images existed and the signed URL returned HTTP 200 from Backstage, which does not prove the provider can download them. The server now sends image bytes using `POST https://api.minimax.cn/v1/files/upload`, purpose `video_generation_input`, then puts `mm_file://{file_id}` into each generation image URL.

- Implementation: `lib/generation-minimax-files.ts`; additive table `generation_minimax_files`.
- Cache key: owner + SHA-256 image contents + SHA-256 credential fingerprint. A new local asset with identical bytes can reuse a file within the same owner/key; another owner or rotated key cannot. No API keys, signed image URLs or provider messages are stored in cache entries.
- MiniMax documents a seven-day file lifetime; cached IDs are reused for six days, with a ten-minute safety margin. A cache miss/expiry uploads again. int64 file IDs are parsed losslessly as strings.
- Per-image advisory locks prevent concurrent duplicate uploads; a busy image remains pending for a later timer run. Per-task locks protect preparation/submission.
- Image-based MiniMax requests are reserved as `preparing` and return immediately. The generation timer uploads references, persists `submitting` immediately before the generation POST, then records the remote ID. Browser refresh is not required. All references must be ready before the generation call. Failed uploads produce `INPUT_UPLOAD_FAILED`; no video task was submitted. Ambiguous paid submissions remain `submitted_unknown` and are never automatically repeated.
- Preparation is bounded per sync run; local durable state and individual cache entries allow interrupted preparation to resume. Initial upload can take longer than an ordinary cached submission.
- New remote media-unreachable errors map to `INPUT_MEDIA_UNREACHABLE` for a readable UI explanation. Existing failed records are retained and are never automatically resubmitted or billed again.
- The reference cache is separate from 14-day output deletion. It does not delete user reference images or uploaded/published videos, and does not change Seedance transport.

Verify on TEST only with `node scripts/verify-generation-files.cjs` (isolated schema, mocked uploads/generation). Real file-only smoke tests may upload a generated fixture, verify cache reuse and retrieve it, then delete that fixture; do not generate paid videos as an incidental test.

Official [file upload contract and lifetime](https://platform.minimax.cn/docs/api-reference/file-management-upload).


## Reference pre-upload (2026-09-16)

MiniMax images are saved unchanged on the server and queued for provider upload as soon as they are selected. No resizing or lossy compression is applied. The asset POST persists a `generation_image_sync` job and Next.js `after` starts processing after the HTTP response; the generation timer resumes pending/retrying jobs after page closure or process restart. Seedance does not enqueue MiniMax image uploads.

`GET /api/generation/assets/:id/sync` returns owner-only status; `POST` enqueues preparation for existing images (including a model switch), and `POST ?retry=1` explicitly retries a failed upload. Responses never expose provider file IDs, credential fingerprints or private URLs. Each thumbnail shows synchronization status and a retry action. Generation can wait in `preparing` for unfinished references and never submits until all references are ready.

Uploads retain original bytes, allow up to 300 seconds, and retry network/timeout/429/5xx failures up to three attempts with a 30-second minimum delay. Up to five advisory-locked transfers run concurrently across processes; each upload reuses its worker DB connection to avoid pool exhaustion; owner/content/key cache reuse and expiry are unchanged. Only classified error codes are logged. Paid generation requests are never automatically resubmitted after an ambiguous response. Failed historical tasks are not retried automatically.

Checks: `node scripts/verify-generation-files.cjs` on TEST with an isolated schema covers ownership, pre-upload, bounded transient retries, manual retry, concurrency, cache reuse, and paid-submission boundaries. A separate large synthetic PNG file-only live check must confirm upstream transfer without submitting a paid video generation.


## Optional reference compression (TEST first)

On the generation page, selecting images larger than 5 MiB opens a confirmation dialog before any upload in that selection. Users can compress only those large images to at most 1 MiB, keep originals, or cancel. Images at or below 5 MiB are unchanged. The original local files are never overwritten. Browser JPEG encoding first adjusts quality (0.94 down to 0.72), then proportionally reduces resolution if necessary; transparent areas become white, disclosed in the dialog. Unsupported decoding (for example HEIC in some browsers) fails explicitly and users can reselect originals. No automatic compression occurs on the server. Both reference and first/last-frame inputs use this opt-in flow.

Generate a real-browser test with `node scripts/verify-image-compression-browser.cjs /tmp/compression-check.html`; open the file in a browser and require PASS. It uses a random 2048-square PNG larger than 5 MiB, tests actual encoding to <=1 MiB, exact threshold, original file preservation, aspect ratio, and unsupported decode handling. No provider API calls.


## Automatic record titles
The generation form no longer asks for a requirement name. The server derives a stable record title from the first 40 Unicode characters of the prompt (whitespace normalized); old clients may still supply a name. The existing database column and historical record titles are retained. A missing name no longer disables submission or causes validation failure; prompts and generation settings remain required.


## Five concurrent reference uploads
Asset callbacks and the generation timer share a draining queue with five workers. PostgreSQL advisory slots enforce a global ceiling of five actual uploads across concurrent requests/processes. A completed worker immediately claims the next eligible image; pending work no longer waits for the next minute merely because an earlier image held the old single-transfer lock. Cache hits are resolved during enqueue, including when all five upload slots are occupied. Retry delays and maximum attempts remain unchanged; future retries and interrupted work retain the timer fallback. Each queue run has a bounded 480-second budget and starts a new transfer only with enough time for its five-minute timeout.

`verify-generation-files.cjs` now exercises eight queued files: peak five uploads, an independent sixth request denied a slot, immediate refill while four earlier uploads remain blocked, cache readiness during saturation, shared callback coalescing, and successful draining without a timer tick. One DB connection per transfer prevents the previous two-connections-per-upload pattern from exhausting the ten-connection pool. No paid video submissions occur in these queue tests.
