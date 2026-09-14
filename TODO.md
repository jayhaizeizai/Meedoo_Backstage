> 历史待办（2026-08-29）：其中三平台、视频过期删除、旧留存评分等口径已过时。当前行为请先阅读 README.md，再核对代码；不要直接照此恢复旧功能。

# MeeDoo implementation TODO

Last updated: 2026-08-29

## Current foundation

- [x] Next.js/React application at the repository root
- [x] Chinese/English UI
- [x] Lark OAuth login, callback, signed session, logout, and protected routes
- [x] Linux production service with Nginx, HTTPS, and automatic certificate renewal
- [x] Lark App ID/Secret stored only in the server environment file
- [x] Upload-Post profile check, async publish/status APIs, and three-platform UI
      implemented (live API-key/account validation still pending)

## P0 — Make publishing real

- [x] Finalize the Upload-Post API plan and confirm its upload, publish, analytics,
      account-connection, rate-limit, and webhook contracts.
- [x] Store the Upload-Post API key and webhook secret in the server environment;
      never expose them to the browser or GitHub.
- [x] Replace the demo publish action with a server API that accepts one video and
      creates TikTok, Instagram, and YouTube Shorts publishing jobs.
- [x] Attribute every upload to the authenticated Lark `open_id` and save the
      uploader name, upload time, title, caption, target platforms, and job IDs.
- [x] Add per-platform states: queued, uploading, processing, published, failed,
      and retrying. Show actionable failure messages without leaking provider data.
- [x] Add webhook signature verification and idempotent webhook processing.
- [x] Add resumable 16 MB chunk uploads to temporary server storage for videos
      up to 1.5 GB, signed provider download URLs, and automatic expiry cleanup.
- [ ] Move temporary media to object storage if concurrency or retention grows
      beyond the test server's disk and bandwidth capacity.

Definition of done: a signed-in Lark user uploads once, all three real platform
jobs are created, and MeeDoo displays the final URL/status for each platform.

## P0 — Persistence and authorization

- [x] Provision PostgreSQL and create an idempotent schema migration for users, videos, platform
      publications, publishing jobs, metric snapshots, and audit logs.
- [x] Upsert Lark users by `open_id`; update their display name and avatar at login.
- [x] Define and enforce the current `member` and `approver` roles.
- [ ] Restrict access to approved Lark tenants, departments, or an explicit user
      allowlist instead of accepting every valid Lark account.
- [ ] Add server-side authorization to all write APIs, not only page redirects.
- [ ] Decide session revocation and user-deactivation behavior.

Definition of done: application data survives restarts, every write has an actor,
and unauthorized users cannot view or mutate team data.

## P0 — Video approval workflow

- [x] Submit uploaded videos to a staging queue without calling Upload-Post.
- [x] Let members view only their own upload history and review comments.
- [x] Let approvers view all pending submissions and securely play the retained video.
- [x] Approve all selected platforms in one decision, or reject with a required comment.
- [x] Treat rejected submissions as final while retaining the rejection comment and audit history.
- [x] Validate the vertical 9:16 video format before accepting a submission.
- [x] Exclude unapproved submissions from every analytics dashboard query.
- [x] Retain pending media for 60 days, rejected/withdrawn media for 7 days, and
      successfully published media for 3 days while retaining database records and links.
- [x] Add 24-hour reminders, a 10:00 AM Puerto Rico daily summary, and 70/85/95%
      disk alerts; block new uploads at 95% disk usage.
- [x] Have Jay sign out and back in through the current test Lark App so its bot can
      address the new App-specific `open_id`, then verify direct-message delivery.
- [ ] Grant Albert the `approver` role after his first production login.

Definition of done: a member submits a valid 9:16 video, an approver can preview
and decide it, only approval starts publishing, and both parties receive the agreed
Lark notifications.

## P1 — Real dashboard data

- [x] Confirm which Upload-Post metrics exist for each platform and how often they
      update.
- [x] Normalize views/reach, likes, watch quality/retention, reposts, shares/sends,
      new followers/subscribers, saves, and comments across the three platforms.
- [x] Build scheduled backfill/sync jobs and webhook-driven incremental updates.
- [x] Replace demo dashboard values with database queries for team, leaderboard,
      individual, and per-video tabs.
- [ ] Implement date-range, platform, member, and video filters.
- [x] Implement the agreed weighted score formula and show
      the calculation source/time for auditability.
- [x] Handle unavailable or non-equivalent metrics explicitly instead of treating
      missing values as zero.

Definition of done: dashboard totals reconcile with provider data and every score
can be traced back to metric snapshots and a weight version.

## P1 — Product completion

- [x] Add publishing status, platform links, and failed-platform retry controls to the video tab.
- [x] Add account connection/health indicators for TikTok, Instagram, and YouTube.
- [ ] Complete loading, empty, error, expired-session, and permission-denied states.
- [ ] Finish Chinese/English copy for backend errors and provider statuses.
- [x] Remove remaining demo labels and sample data when real data is available.
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
- [x] Add in-app notifications and optional Lark bot messages (requires the
      `im:message` permission and `LARK_NOTIFY_ENABLED=true`).
- [ ] Decide production domain naming and whether to replace the current
      `backstagetest` hostname.
