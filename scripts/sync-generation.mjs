const secret = process.env.CRON_SECRET;
if (!secret) throw Error("CRON_SECRET_NOT_CONFIGURED");
const response = await fetch("http://127.0.0.1:3000/api/generation/sync", {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(1200000),
});
if (!response.ok) throw Error(`GENERATION_SYNC_HTTP_${response.status}`);
console.log("Generation sync completed");
