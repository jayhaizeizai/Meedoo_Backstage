# MeeDoo implementation TODO

Last updated: 2026-08-27

## Current foundation

- [x] Next.js/React upload and dashboard demo
- [x] Chinese/English UI
- [x] Lark OAuth login, callback, signed session, logout, and protected routes
- [x] Linux production service with Nginx, HTTPS, and automatic certificate renewal
- [x] Lark App ID/Secret stored only in the server environment file

## P0 — Make publishing real

- [ ] Finalize the Upload-Post API plan and confirm its upload, publish, analytics,
      account-connection, rate-limit, and webhook contracts.
- [ ] Store the Upload-Post API key and webhook secret in the server environment;
      never expose them to the browser or GitHub.
- [ ] Replace the demo publish action with a server API that accepts one video and
      creates TikTok, Instagram, and YouTube Shorts publishing jobs.
- [ ] Attribute every upload to the authenticated Lark `open_id` and save the
      uploader name, upload time, title, caption, target platforms, and job IDs.
- [ ] Add per-platform states: queued, uploading, processing, published, failed,
      and retrying. Show actionable failure messages without leaking provider data.
- [ ] Add webhook signature verification and idempotent webhook processing.
- [ ] Decide the file-storage flow. Prefer direct-to-object-storage uploads with
      signed URLs so 300 MB videos do not pass through the Next.js process.

Definition of done: a signed-in Lark user uploads once, all three real platform
jobs are created, and MeeDoo displays the final URL/status for each platform.

## P0 — Persistence and authorization

- [ ] Provision PostgreSQL and create migrations for users, videos, platform
      publications, publishing jobs, metric snapshots, and audit logs.
- [ ] Upsert Lark users by `open_id`; update their display name and avatar at login.
- [ ] Define roles: member, team lead, and administrator.
- [ ] Restrict access to approved Lark tenants, departments, or an explicit user
      allowlist instead of accepting every valid Lark account.
- [ ] Add server-side authorization to all write APIs, not only page redirects.
- [ ] Decide session revocation and user-deactivation behavior.

Definition of done: application data survives restarts, every write has an actor,
and unauthorized users cannot view or mutate team data.

## P1 — Real dashboard data

- [ ] Confirm which Upload-Post metrics exist for each platform and how often they
      update.
- [ ] Normalize views/reach, likes, watch quality/retention, reposts, shares/sends,
      new followers/subscribers, saves, and comments across the three platforms.
- [ ] Build scheduled backfill/sync jobs and webhook-driven incremental updates.
- [ ] Replace demo dashboard values with database queries for team, leaderboard,
      individual, and per-video tabs.
- [ ] Implement date-range, platform, member, and video filters.
- [ ] Implement the agreed weighted score formula, version its weights, and show
      the calculation source/time for auditability.
- [ ] Handle unavailable or non-equivalent metrics explicitly instead of treating
      missing values as zero.

Definition of done: dashboard totals reconcile with provider data and every score
can be traced back to metric snapshots and a weight version.

## P1 — Product completion

- [ ] Add a publishing history/status page and retry controls.
- [ ] Add account connection/health indicators for TikTok, Instagram, and YouTube.
- [ ] Complete loading, empty, error, expired-session, and permission-denied states.
- [ ] Finish Chinese/English copy for backend errors and provider statuses.
- [ ] Remove remaining demo labels and sample data when real data is available.
- [ ] Confirm mobile behavior inside the Lark desktop and mobile clients.
- [ ] Decide export requirements for dashboard and leaderboard data.

## P1 — Testing and delivery

- [ ] Add unit tests for session signing, OAuth state validation, safe redirects,
      scoring, and metric normalization.
- [ ] Add integration tests for Lark callback, Upload-Post webhooks, idempotency,
      database writes, and authorization.
- [ ] Add end-to-end tests for login, upload, publish status, dashboard, and logout.
- [ ] Add CI for type checking, tests, production build, and secret scanning.
- [ ] Add a controlled deployment workflow with health checks and rollback.
- [ ] Separate development, staging, and production credentials/data.

## P1 — Security and operations

- [ ] Rotate the server root password that was shared during setup.
- [ ] Create a non-root deployment user with SSH keys, disable password-based root
      SSH login, and add firewall/fail2ban protection.
- [ ] Rotate Lark and Upload-Post secrets if they are ever exposed; document the
      rotation procedure.
- [ ] Add database backups and periodically test restoration.
- [ ] Add uptime, application error, webhook failure, queue depth, disk, and
      certificate-expiry monitoring.
- [ ] Add structured logs with request/job IDs while excluding access tokens,
      secrets, cookies, and private video URLs.
- [ ] Review privacy, retention, deletion, and social-platform policy requirements.

## Later decisions

- [ ] Decide whether MeeDoo should remain a Lark Web App only or also expose a
      standalone browser login.
- [ ] Decide whether team/score settings need an admin UI.
- [ ] Decide notification channels for publish success/failure (Lark bot, email,
      or in-app only).
- [ ] Decide production domain naming and whether to replace the current
      `backstagetest` hostname.
