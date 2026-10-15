const secret = process.env.CRON_SECRET;
if (!secret) throw Error("CRON_SECRET_NOT_CONFIGURED");
const response = await fetch("http://127.0.0.1:3000/api/review-previews/sync", {
  method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(660000),
});
if (!response.ok) throw Error(`PREVIEW_SYNC_HTTP_${response.status}`);
console.log("Review preview worker completed");
