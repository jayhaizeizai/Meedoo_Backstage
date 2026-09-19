# Signed publication media lifecycle

Publication media URLs remain signed and expire after six hours. Never log their signatures.

For a submitted upload, media access requires approval and must stop after removal or file deletion. Access must not depend on the temporary upload-session publishing status: a rejected provider submission restores the session to `submitted`, while a per-platform retry does not transition that session. The old media route consequently returned 404 during retries. A provider download can also outlive the original submission call.

The media route now checks the upload's approval/removal state. A staging session without an upload record remains accessible only when `ready`. Invalid/expired signatures still return 403; unapproved, removed, deleted or missing media returns 404. GET byte ranges and HEAD remain supported.

Run `node scripts/verify-media-lifecycle.cjs` for synthetic local-file coverage without provider calls or social publishing. The old implementation fails the approved/submitted case; the repaired implementation also checks that pending/rejected/removed/deleted videos stay inaccessible.

## September 19 investigation

The production incident returned `Video URL is not allowed.` about five seconds after approval. Retained nginx logs contain no request to that video's `/api/media/` endpoint at submission time; a later diagnostic HEAD returned 404 because the session had been restored to `submitted`. This confirms the retry defect, but does not establish why Upload-Post initially rejected the URL. Do not describe this repair as a confirmed fix for that original upstream rejection. Further provider-side diagnosis requires their rejection details; do not automatically republish the production task to test a hypothesis.
