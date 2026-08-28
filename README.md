# MeeDoo

Next.js application for Lark-authenticated short-video publishing and analytics.

## Routes

- `/upload` — video selection and cross-platform publishing
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
UPLOAD_POST_WEBHOOK_SECRET=your_webhook_secret
DATABASE_URL=postgresql://meedoo:password@127.0.0.1:5432/meedoo
MEEDOO_MEDIA_DIR=/var/lib/meedoo/media
CRON_SECRET=replace_with_a_long_random_secret
```

After restarting `meedoo.service`, the upload page verifies the profile's
TikTok, Instagram, and YouTube connections. Publishing uses `async_upload=true`,
stores the provider request/job IDs in PostgreSQL, and polls the Upload-Post
status endpoint until completion. TikTok uses `DIRECT_POST` with
inbox fallback disabled so a draft is not reported as a successful public post.

`meedoo-sync.timer` imports Upload-Post history and refreshes Analytics every 15
minutes. The signed `/api/upload-post/webhook` endpoint applies terminal status
updates idempotently. Original files are retained under `MEEDOO_MEDIA_DIR` for
failed-platform retry; object storage remains the recommended production upgrade.

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
