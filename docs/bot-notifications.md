# Bot notifications

`LARK_NOTIFY_ENABLED=true` enables queued personal Lark notifications.

`LARK_PUBLISH_FAILURE_ADMIN_OPEN_ID` selects the system administrator receiving a copy of the existing `publish_failed` event (submission to Upload-Post failed after approval). Configure the exact open ID of Jay's approver account separately in each environment; Lark application open IDs must not be copied between test and production. The recipient must exist with the approver role. The uploader continues receiving the message; if both recipients are the same account, only one notification is queued. Other notification events are unchanged. This does not add notifications for subsequent asynchronous per-platform failures.

The daily approval digest remains English plain text: `MeeDoo daily approval summary (N):`, followed by numbered `title — uploader` lines and the approvals-list URL. It contains pending reviews only, up to 20 items. It runs in the 10:00 hour in America/Puerto_Rico (22:00 Singapore), once per local date. Weekends include only submissions from the last 24 hours; no pending records means no digest.

`node scripts/verify-reliability.cjs` tests failure-copy recipient selection and duplicate prevention with synthetic records and mocked Lark delivery on the test environment.
