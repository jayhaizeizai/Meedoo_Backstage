# Assignment System

First version: each signed-in user manages their own assignments. Assignment routes never inherit approver access to another user's task. Existing approver generation-history visibility remains unchanged. Deployment starts on the test environment only.

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
