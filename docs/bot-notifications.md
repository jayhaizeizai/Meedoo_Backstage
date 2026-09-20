# Bot notifications

`LARK_NOTIFY_ENABLED=true` enables queued personal Lark notifications.

`LARK_PUBLISH_FAILURE_ADMIN_OPEN_ID` selects the system administrator receiving a copy of the existing `publish_failed` event (submission to Upload-Post failed after approval). Configure the exact open ID of Jay's approver account separately in each environment; Lark application open IDs must not be copied between test and production. The recipient must exist with the approver role. The uploader continues receiving the message; if both recipients are the same account, only one notification is queued. Other notification events are unchanged. This does not add notifications for subsequent asynchronous per-platform failures.

The daily approval digest has three bilingual sections: Pending, Approved, Rejected. Pending includes all outstanding reviews every day, including weekends. Approved/rejected include current review results with reviewed_at in [previous digest through, current run); the first upgraded run defaults to the prior 24 hours. Each section reports the full count, displays up to 20 titles/uploaders, and indicates any omitted items. Rejected items include a bounded rejection reason. Empty sections say None; if all are empty, no message is sent. Approved is explicitly distinguished from published. The window is displayed in Singapore time. Scheduling remains the 10:00 hour in America/Puerto_Rico (22:00 Singapore). A transaction/advisory lock queues recipients and advances the reporting boundary together to prevent duplicate daily messages.

`node scripts/verify-reliability.cjs` tests failure-copy recipient selection and duplicate prevention with synthetic records and mocked Lark delivery on the test environment.
