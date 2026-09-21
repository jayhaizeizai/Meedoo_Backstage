# Assignment System

Unassigned tasks are visible to all signed-in members. Assigned tasks are visible only to the assignee (owner) and approvers (administrators). Creator is stored separately in owner_id; assignee_id is the responsible owner. New tasks require a deadline, displayed/entered in Singapore time. Creators can manage their unassigned tasks, owners manage assigned tasks, and admins manage any task. Any member can claim an unassigned task; concurrent claims use row locks and versions. Assignment media/download routes enforce the same visibility. Existing private pre-release tasks migrate with their creator as assignee. Deployment starts on the test environment only.

## Workflow

1. Create a titled text brief. Generate an AI summary draft and apply it, or edit it manually.
2. Generate a 16:9 storyboard through the existing Seedream queue (2K default), or upload a JPG/PNG/WebP. Select and save the active storyboard. Uploaded files use existing asset storage; generated files retain the existing 14-day expiry.
3. Ask the planner to read the saved storyboard or brief. Review its ordered shot descriptions before applying. These are video prompts, not automatic pixel crops of the storyboard. Upload a single-shot reference/first frame where needed; a full storyboard grid is not automatically used as the video first frame.
4. Save edits to a shot, choose MiniMax/Seedance model, duration, resolution, aspect ratio, reference or first/last-frame mode, then generate. Each request is linked to the shot and uses the existing generation system (including limits, sync, error reporting, usage and retention).
5. Download individual videos or a streaming ZIP of all available successful takes. ZIP filenames are ordered by shot, with a manifest for included/unavailable attempts. ZIP32 has a 3 GiB cap; use individual downloads above that limit.

## Modules

- `components/assignments.tsx`, `styles/assignments.css`: bilingual task list and workspace.
- `app/api/assignments/**`: authenticated CRUD, planning, generation and streamed download endpoints; mutation origin checks reuse generationUser.
- `lib/assignments/schema.ts`: four additive tables: assignments, assignment_shots, assignment_runs, assignment_plans.
- `data.ts`: ownership, optimistic versions, shot editing, generation association and idempotency.
- `planner.ts`: bounded JSON text/vision planner; persistent queue resumed by the generation timer and Next after callbacks.
- `model.ts`: validation of bounded planner results.
- `zip.ts`: stored streaming ZIP writer, CRC32 + data descriptors; does not buffer whole videos.

## Configuration

Uses the existing server-side ARK_API_KEY. Optional ASSIGNMENT_PLANNER_MODEL defaults to doubao-seed-2-0-lite-260215 (text and image understanding); it must be enabled for this Ark account. Model list: https://www.volcengine.com/docs/82379/1795150 . API: https://www.volcengine.com/docs/82379/1494384 . No keys are returned to browsers. UI exposes safe error categories, never raw provider payloads or signed URLs.

The planner requests JSON with summary, storyboardPrompt, and ordered shots (title, prompt, integer duration). Provider output is validated; invalid/truncated output never replaces edits. Suggestions carry source_version; applying a stale draft fails. Shot replacement is blocked once any video attempt is attached. No automated paid retries after worker interruption.

Generation associations are reserved before provider work. assignment_runs.id equals the existing generation request_id. Detail queries join by owner + request_id, recovering links after a crash. The Resume submission action reuses that same request and input. Pending or uncertain attempts block a new submission for the same shot. Historical versions remain available.

## Validation

`node scripts/verify-assignments.cjs` requires the test Lark identity, creates an isolated schema, mocks providers and forbids unexpected network calls. It verifies cross-user denial, optimistic versions, planning with a reference image, draft application, protection of generated shots, concurrent submission idempotency, storyboard association, and ZIP integrity via Python zipfile. Do not run this fixture script against production.

## Assignment handoff

Task-scoped media URLs validate both task visibility and actual asset/run membership. Referenced assets from a previous owner remain viewable inside the task. When another owner/admin generates from an attached reference, the server makes an idempotent copy in that actor's existing generation namespace; general generation endpoints do not gain cross-user access. Runs and planner jobs retain the actual actor for usage attribution, while the task detail includes all attached runs regardless of actor. Reassigning or changing deadlines increments the version so stale planning proposals cannot overwrite newer task state. Model generation history outside Assignment System retains its existing creator/admin ownership rules.

## Per-shot studio

Shots use previous/next navigation and a shot selector; only the active shot studio mounts. `components/generation-workspace.tsx` is shared with `/generate`, including image editing, references/frames, compression, provider image readiness, video preview, history, error details and failed-input restore. The regular generation page remains a thin wrapper. Local drafts are namespaced by actor + assignment + shot, and reset clears only that shot's image/video drafts. Switching is disabled only while uploading/submitting; queued work continues on the server.

`/api/assignments/[id]/shots/[shot]/generation/[[...operation]]` adapts the shared studio to scoped history, submission, media, restore and asset resolution. `shot-studio.ts` checks assignment and shot membership. Image runs reuse kind=storyboard with a non-null shot_id; task-level storyboards have a null shot_id. Both image and video attempts prevent replacing the whole shot list. Referenced images from a previous owner are adopted into the new actor's namespace before MiniMax preparation. No provider credentials reach the browser.

## Runtime visibility switch

`/etc/meedoo/features.json` controls this feature with `{"assignments":true}` or `false`. `MEEDOO_FEATURES_FILE` can override the file path. Missing/invalid configuration is disabled. Test is enabled; production remains disabled until explicitly requested. The server exposes only the boolean through `/api/auth/me`; navigation hides the entry, the proxy returns 404 for both the page and assignment APIs, and the planner timer skips assignment jobs while disabled. Existing image/video jobs retain their normal durable queue. Config is read at runtime, so switching does not require rebuilding. Already-open clients should refresh to update navigation.
