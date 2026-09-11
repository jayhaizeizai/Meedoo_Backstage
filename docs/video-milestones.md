# Video view celebrations

After the existing analytics synchronization (every 15 minutes), sum each upload's latest `views` across its completed, active YouTube, Instagram and TikTok publications. Never substitute reach, impressions, account totals or previous snapshots for missing views. Invalid/negative/fractional values do not count. Partial available totals can qualify and the message explicitly identifies unavailable metrics. The upload ID links its three publications; unrelated uploads are never combined by title.

Milestones are 10,000, 30,000 and 100,000 inclusive. Each upload/threshold is recorded once. If a poll crosses several thresholds, only the highest is sent and lower ones are marked superseded. A decrease followed by recovery does not send the same milestone again.

Configuration in `/etc/meedoo/meedoo.env`:

- `MEEDOO_MILESTONES_ENABLED=true`: detect and record milestones.
- `MEEDOO_MILESTONES_SEND_ENABLED=true`: send genuine new milestones to the configured group; defaults off.
- `MEEDOO_MILESTONES_CHAT_ID`: target Lark chat. The environment's own bot must be in that chat.

First detection records existing milestones as baseline without sending, even with sending enabled. Previously created videos discovered later are also baselined on first observation. Muted milestones are consumed without later catch-up. To start with no historical backlog, run detection once with sending off, then enable sending and restart the application.

Messages show the authored title, uploader, combined views, platform breakdown and available platform links. Local media deletion does not prevent celebrations for still-active publications. Removed uploads/publications and unapproved uploads are excluded.

Detection is transactionally serialized and events have a unique upload/threshold constraint. Delivery is claimed durably before sending, with a stable Lark UUID. `failed`, `uncertain` and interrupted `sending` records are not automatically resent; investigate before manually recovering them to avoid duplicate messages. Provider-accepted messages are marked `sent` only when Lark returns a successful response with a message ID.

Approvers can inspect configuration, last detection, status counts and the latest 50 events at `GET /api/milestones`. Other members cannot access this endpoint. No test-message endpoint is provided.

Development tests use temporary database tables and mock all Lark network traffic. Test environment sending remains off. Never send test messages to the production group.
