# MeeDoo

Next.js application for Lark-authenticated short-video publishing and analytics.

## Routes

- `/upload` — video selection and cross-platform publishing
- `/records` — the signed-in member's upload, review, and publishing history
- `/approvals` — pending review queue for approvers
- `/dashboard` — team overview, leaderboard, video data, and personal score views
- `/login` — Lark OAuth sign-in entry
- `/api/auth/lark/callback` — Lark OAuth callback

## Local development

```bash
pnpm install
pnpm dev
```

## Production build

```bash
pnpm build
pnpm start
```

Publishing records, Lark upload attribution, per-platform job IDs/statuses,
analytics snapshots, webhook deliveries, and notifications are stored in
PostgreSQL. The Dashboard reads only real synchronized data.

## Upload-Post publishing

The server reads these values from `/etc/meedoo/meedoo.env`:

```text
UPLOAD_POST_API_KEY=your_api_key
UPLOAD_POST_PROFILE=meedoo_team
UPLOAD_POST_HISTORY_AFTER=
UPLOAD_POST_WEBHOOK_SECRET=your_webhook_secret
DATABASE_URL=postgresql://meedoo:password@127.0.0.1:5432/meedoo
MEEDOO_MEDIA_DIR=/var/lib/meedoo/media
MEDIA_URL_SECRET=replace_with_a_long_random_secret
CRON_SECRET=replace_with_a_long_random_secret
```

After restarting `meedoo.service`, the upload page verifies the profile's
TikTok, Instagram, and YouTube connections. A completed upload first enters the
approval queue; Upload-Post is called only after an approver accepts the submission.
Publishing uses `async_upload=true`,
stores the provider request/job IDs in PostgreSQL, and polls the Upload-Post
status endpoint until completion. TikTok uses `DIRECT_POST` with
inbox fallback disabled so a draft is not reported as a successful public post.

Videos up to 1.5 GB are uploaded to MeeDoo temporary storage in 16 MB resumable
chunks. The server validates a vertical 9:16 video with `ffprobe`. After approval,
MeeDoo gives Upload-Post a six-hour signed media URL; the API key and local
filesystem path never reach the browser.

`meedoo-sync.timer` imports Upload-Post history and refreshes Analytics every 15
minutes. The signed `/api/upload-post/webhook` endpoint applies terminal status
updates idempotently. Pending files are retained for 60 days, rejected or withdrawn
files for 7 days, and successfully published files for 3 days. Approved files with
a failed platform are retained for retry. Database records and platform links remain
after media cleanup; object storage remains the recommended production upgrade.
Set `UPLOAD_POST_HISTORY_AFTER` to an ISO timestamp when an environment must
ignore older provider history, for example after intentionally clearing test data.

## One-time organic history import

`scripts/import-organic-history.mjs` imports videos that were published directly
on YouTube, Instagram, or TikTok before MeeDoo existed. It is dry-run by default:

```bash
pnpm history:dry-run
```

Review `outputs/organic-history-report.json` before applying it to PostgreSQL:

```bash
node scripts/import-organic-history.mjs --apply-db \
  --default-owner-name="Jay Lee"
```

Owners are optional. Unassigned history remains visible in team and video totals
but is omitted from personal rankings until the member signs in with Lark and
their `open_id` is added to the owner map.

### Follower attribution

MeeDoo stores the current follower total for each connected platform during every
scheduled sync. Positive follower changes are attributed only to videos that were
inside their first 24 hours during that interval. Allocation is weighted by each
eligible video's incremental views; when no view delta is available, the increase
is split evenly. Direct per-post `new_followers` metrics take precedence when a
platform provides them. This preserves the account-level total without claiming
that the attribution is exact, and older videos without a pre-publication baseline
remain unavailable.

### Equivalent retention score

Retention is displayed as a normalized 0–100 score rather than mixing incompatible
platform percentages. YouTube uses `average_view_percentage`, capped at 100. TikTok
combines average watched duration divided by video duration (65%) with
`full_video_watched_rate` (35%); if only one component is available its weight is
renormalized. Instagram remains unavailable until its Reels watch-time metrics are
exposed by the configured analytics provider. Missing metrics stay unavailable and
are never converted to zero. Team and multi-platform scores are weighted by views.

To back up, rebuild, and populate a Lark Base after granting the app
`bitable:app`, set `LARK_BASE_APP_TOKEN` and run:

```bash
node scripts/import-organic-history.mjs --apply-db --sync-lark --reset-lark
```

A reviewed report can be replayed in another environment without giving that
environment access to the production Upload-Post profile:

```bash
node scripts/import-organic-history.mjs \
  --input-report=outputs/organic-history-report.json --sync-lark --reset-lark
```

Use `--regroup-input` only when intentionally re-running the automatic matching
algorithm against the platform rows inside an earlier report.

Exclude a known deleted, private, test, or otherwise out-of-scope platform post
by its ID (optionally prefixed with the platform):

```bash
node scripts/import-organic-history.mjs \
  --exclude-post-id=youtube:OxKTqJLWN3U
```

The script exports every existing table, field, and record to a timestamped JSON
backup before creating the replacement table. Existing tables are deleted only
after the replacement has been populated successfully.

## Lark authentication

Copy `.env.example` to the server environment file and provide real values. In
production, the systemd service reads `/etc/meedoo/meedoo.env` so secrets never
need to be committed to Git.

Configure this exact redirect URL in the Lark developer console:

```text
https://backstagetest.meedoo.fun/api/auth/lark/callback
```

The login flow requests the built-in `auth:user.id:read` OAuth scope, exchanges
the authorization code only on the server, and stores a signed seven-day
HTTP-only session cookie. No additional contact API permission is required for
the first login test. Set `LARK_AUTH_REQUIRED=true` after the app has been
installed and tested.

See [`docs/lark-setup.md`](docs/lark-setup.md) for the Lark console checklist.
See [`TODO.md`](TODO.md) for the prioritized implementation backlog.
