// TEST ONLY. Isolated schema, synthetic records, all external calls mocked. Drops its schema on exit.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHmac } = require("node:crypto"),
  { Pool } = require("pg"),
  ts = require("typescript");
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    f,
  );
const root = path.resolve(__dirname, "..");
const mock = (name, exports) => {
  const f = path.join(root, name);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const schema = "reliability_" + randomUUID().replaceAll("-", "");
let apiCalls = [],
  mode = "ok",
  hold,
  release;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const provider = {
  getUploadPostConfig: () => ({ profile: "fixture", apiKey: "fixture" }),
  supportedPlatforms: ["youtube", "instagram", "tiktok"],
  parseProviderResponse: (r) => r.json(),
  providerMessage: (p, f) => p.message || f,
  uploadPostFetch: async (endpoint, init = {}) => {
    apiCalls.push({ endpoint, method: init.method || "GET" });
    if (init.method === "POST") {
      if (mode === "timeout") throw new Error("mock timeout");
      if (hold) await hold;
      return json({
        success: true,
        request_id: init.body.get("request_id"),
        job_id: "retry-job",
      });
    }
    if (endpoint.includes("/history")) return json({ history: [] });
    if (endpoint.includes("/status")) return json({ status: "processing" });
    const platform = new URL("https://fixture" + endpoint).searchParams.get(
      "platform",
    );
    return json({
      platforms: { [platform]: { post_metrics: { views: 123, likes: 2 } } },
    });
  },
};
mock("lib/upload-post.ts", provider);
mock("lib/server-auth.ts", {
  getCurrentUser: async () => ({ openId: "fixture-user", name: "Fixture" }),
});
mock("lib/media-url.ts", {
  createMediaUrl: () => "https://fixture.invalid/video",
});
mock("lib/maintenance.ts", { runMaintenance: async () => ({}) });
mock("lib/upload-staging.ts", { cleanupExpiredUploadSessions: async () => 0 });
mock("lib/profile-analytics.ts", { syncProfileAnalytics: async () => ({}) });
mock("lib/video-milestones.ts", { syncVideoMilestones: async () => ({}) });
mock("lib/dashboard-cache.ts", {
  expireDashboardCache: async () => {},
  invalidateDashboardCache: async () => {},
  refreshDashboardCache: async () => {},
});

async function main() {
  assert.equal(
    process.env.LARK_APP_ID,
    "cli_aa1a6845a1f8de15",
    "Only run against test environment",
  );
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  global.meedooPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 10,
  });
  process.env.LARK_NOTIFY_ENABLED = "false";
  // Fail closed: no unmocked network request is allowed.
  global.fetch = async () => {
    throw new Error("UNEXPECTED_EXTERNAL_REQUEST");
  };
  const db = require("../lib/db.ts");
  let failPublication = false,
    entryInserts = 0;
  const realTransaction = db.transaction;
  db.transaction = (fn) =>
    realTransaction((client) =>
      fn(
        new Proxy(client, {
          get(target, key) {
            if (key === "query")
              return (sql, args) => {
                if (failPublication && /UPDATE publications SET/.test(sql)) {
                  failPublication = false;
                  throw new Error("injected DB failure");
                }
                if (/INSERT INTO libtv_credit_entries/.test(sql))
                  entryInserts++;
                return target.query(sql, args);
              };
            return Reflect.get(target, key);
          },
        }),
      ),
    );
  try {
    await db.ensureSchema();
    await db.query(
      "INSERT INTO meedoo_users(open_id,name,role) VALUES('fixture-user','Fixture','approver')",
    );
    const { safeReturnTo } = require("../lib/safe-return-to.ts");
    for (const bad of [
      "//evil.invalid",
      "/\\evil.invalid",
      "/\nevil.invalid",
      "https://evil.invalid",
    ])
      assert.equal(safeReturnTo(bad), "/upload");
    assert.equal(
      safeReturnTo("/dashboard?days=7#video"),
      "/dashboard?days=7#video",
    );
    const { syntheticUuid } = require("../lib/records.ts");
    assert.notEqual(
      syntheticUuid("abcdefghijklmnop-A"),
      syntheticUuid("abcdefghijklmnop-B"),
    );
    assert.equal(syntheticUuid("same"), syntheticUuid("same"));
    console.log("PASS safe redirects and full-seed deterministic IDs");

    const id = randomUUID();
    await db.query(
      `INSERT INTO uploads(id,request_id,title,caption,profile_username,status,target_platforms,uploader_open_id,original_filename,media_path)
      VALUES($1,'original-request','Fixture','','fixture','failed',ARRAY['youtube','instagram'],'fixture-user','fixture.mp4','/fixture/video')`,
      [id],
    );
    await db.query(
      `INSERT INTO publications(upload_id,platform,request_id,provider_job_id,status) VALUES($1,'youtube','original-request','old-job','failed'),($1,'instagram','original-request','ig-job','completed')`,
      [id],
    );
    const retry = require("../app/api/upload-post/retry/route.ts");
    const request = () =>
      new Request("https://fixture/api/upload-post/retry", {
        method: "POST",
        body: JSON.stringify({ uploadId: id, platform: "youtube" }),
      });
    hold = new Promise((resolve) => {
      release = resolve;
    });
    const attempts = [retry.POST(request()), retry.POST(request())];
    for (let i = 0; i < 100 && !apiCalls.some((c) => c.method === "POST"); i++)
      await new Promise((r) => setTimeout(r, 5));
    release();
    hold = undefined;
    const results = await Promise.all(attempts);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(apiCalls.filter((c) => c.method === "POST").length, 1);
    console.log("PASS concurrent retries issue one external request");
    const sync = require("../lib/upload-post-sync.ts");
    const current = (
      await db.query(
        "SELECT request_id FROM publications WHERE upload_id=$1 AND platform='youtube'",
        [id],
      )
    ).rows[0].request_id;
    await sync.applyStatusPayload("original-request", {
      status: "failed",
      platforms: {
        youtube: { status: "failed" },
        instagram: { status: "completed" },
      },
    });
    assert.equal(
      (
        await db.query(
          "SELECT status FROM publications WHERE upload_id=$1 AND platform='youtube'",
          [id],
        )
      ).rows[0].status,
      "queued",
    );
    await sync.applyStatusPayload(current, {
      status: "completed",
      platforms: {
        youtube: { status: "completed", platform_post_id: "yt-fixture" },
      },
    });
    assert.equal(
      (await db.query("SELECT status FROM uploads WHERE id=$1", [id])).rows[0]
        .status,
      "completed",
    );
    await db.query(
      "UPDATE publications SET status='failed' WHERE upload_id=$1 AND platform='youtube'",
      [id],
    );
    mode = "timeout";
    assert.equal((await retry.POST(request())).status, 202);
    mode = "ok";
    const reconciling = (
      await db.query(
        "SELECT status,request_id FROM publications WHERE upload_id=$1 AND platform='youtube'",
        [id],
      )
    ).rows[0];
    assert.equal(reconciling.status, "reconciling");
    apiCalls = [];
    await sync.syncPendingStatuses();
    assert(apiCalls.some((c) => c.endpoint.includes(reconciling.request_id)));
    assert.equal((await retry.POST(request())).status, 409);
    console.log(
      "PASS stale status ignored; uncertain request reconciled without reposting",
    );

    process.env.UPLOAD_POST_WEBHOOK_SECRET = "fixture-signature-secret";
    const webhook = require("../app/api/upload-post/webhook/route.ts");
    await db.query(
      "UPDATE publications SET provider_job_id='current-job' WHERE upload_id=$1 AND platform='youtube'",
      [id],
    );
    const delivery = randomUUID();
    function hook(job = "current-job") {
      const raw = JSON.stringify({
          job_id: job,
          platform: "youtube",
          result: { success: true, post_id: "yt-fixture" },
        }),
        timestamp = String(Math.floor(Date.now() / 1000));
      return new Request("https://fixture/api/upload-post/webhook", {
        method: "POST",
        body: raw,
        headers: {
          "x-upload-post-timestamp": timestamp,
          "x-upload-post-signature": createHmac(
            "sha256",
            process.env.UPLOAD_POST_WEBHOOK_SECRET,
          )
            .update(`${timestamp}.${raw}`)
            .digest("hex"),
          "x-upload-post-delivery": delivery,
          "x-upload-post-event": "upload_completed",
        },
      });
    }
    failPublication = true;
    assert.equal((await webhook.POST(hook())).status, 503);
    assert.equal(
      (
        await db.query(
          "SELECT count(*) n FROM webhook_deliveries WHERE delivery_id=$1",
          [delivery],
        )
      ).rows[0].n,
      "0",
    );
    assert.equal((await webhook.POST(hook())).status, 200);
    assert.equal((await (await webhook.POST(hook())).json()).duplicate, true);
    console.log("PASS webhook failure rollback, redelivery, and idempotency");

    for (let n = 0; n < 85; n++) {
      const uid = randomUUID();
      await db.query(
        "INSERT INTO uploads(id,title,caption,profile_username,status,target_platforms) VALUES($1,'organic','','fixture','completed',ARRAY['youtube'])",
        [uid],
      );
      await db.query(
        "INSERT INTO publications(upload_id,platform,platform_post_id,status) VALUES($1,'youtube',$2,'completed')",
        [uid, "organic-" + n],
      );
    }
    apiCalls = [];
    await sync.syncAnalytics();
    await sync.syncAnalytics();
    const seen = new Set(
      apiCalls.map((c) =>
        new URL("https://fixture" + c.endpoint).searchParams.get(
          "platform_post_id",
        ),
      ),
    );
    for (let n = 0; n < 85; n++) assert(seen.has("organic-" + n));
    console.log("PASS fair analytics rotation covers all 85 organic videos");
    const locker = await global.meedooPool.connect();
    await locker.query("SELECT pg_advisory_lock(7241902)");
    assert.equal((await sync.syncAll()).alreadyRunning, true);
    await locker.query("SELECT pg_advisory_unlock(7241902)");
    locker.release();
    console.log("PASS cross-connection full-sync lock");

    const { importLibTvCsv } = require("../lib/libtv-accounting.ts");
    const header =
      "消耗时间,类型,模型,任务详情,项目名称,任务 ID,成员 ID,成员昵称,成员备注名,项目 ID,积分值";
    const csv =
      header +
      "\n" +
      Array.from(
        { length: 1001 },
        (_, i) => `2026-09-10 12:00:00,创作,m,t,p,task${i},1,Fixture,,p,-1`,
      ).join("\n");
    const input = {
      bytes: Buffer.from(csv),
      filename: "fixture.csv",
      packagePoints: 16300,
      packageCostCny: 649,
      user: { openId: "fixture-user" },
    };
    const imported = await importLibTvCsv(input);
    assert.equal(imported.importedRows, 1001);
    assert.equal(entryInserts, 3);
    assert.equal((await importLibTvCsv(input)).duplicateFile, true);
    assert.equal(
      (
        await importLibTvCsv({
          ...input,
          bytes: Buffer.from(csv + "\n"),
          filename: "overlap.csv",
        })
      ).importedRows,
      0,
    );
    console.log(
      "PASS 1001 CSV rows batched into 3 inserts; duplicates and overlap preserved",
    );
    const notifications = require("../lib/notifications.ts");
    await notifications.notifyUser(
      "fixture-user",
      null,
      "fixture",
      "Fixture queued message",
    );
    assert.equal(
      (
        await db.query(
          "SELECT lark_queued FROM notifications WHERE kind='fixture'",
        )
      ).rows[0].lark_queued,
      true,
    );
    // Test delivery result codes and token reuse, without contacting Lark.
    await db.query(
      "UPDATE notifications SET lark_queued=false WHERE kind<>'fixture'",
    );
    let tokenCalls = 0,
      messageCalls = 0;
    global.fetch = async (url) =>
      url.includes("tenant_access_token")
        ? (tokenCalls++,
          json({ code: 0, tenant_access_token: "fixture", expire: 7200 }))
        : (messageCalls++, json({ code: 0 }));
    process.env.LARK_NOTIFY_ENABLED = "true";
    await notifications.flushNotifications();
    await notifications.notifyUser("fixture-user", null, "fixture-2", "Second");
    await notifications.flushNotifications();
    assert.equal(tokenCalls, 1);
    assert.equal(messageCalls, 2);
    console.log("PASS durable notification queue and tenant token reuse");
    await notifications.notifyUser(
      "fixture-user",
      null,
      "fixture-fail",
      "Failure",
    );
    global.fetch = async () => json({ code: 9999 });
    await notifications.flushNotifications();
    assert.equal(
      (
        await db.query(
          "SELECT delivered_to_lark FROM notifications WHERE kind='fixture-fail'",
        )
      ).rows[0].delivered_to_lark,
      false,
    );
    console.log("PASS Lark business error remains queued for retry");
    process.env.LARK_NOTIFY_ENABLED = "false";
    const promises = require("node:fs/promises"),
      originalRm = promises.rm;
    try {
      promises.rm = async () => {
        const e = new Error("fixture permission error");
        e.code = "EACCES";
        throw e;
      };
      await db.query(
        "UPDATE uploads SET media_delete_after=now()-interval '1 hour',media_path='/fixture/video' WHERE id=$1",
        [id],
      );
      delete require.cache[path.join(root, "lib/maintenance.ts")];
      process.env.MEEDOO_MEDIA_DIR = "";
      assert.equal(
        (await require("../lib/maintenance.ts").runMaintenance()).filesDeleted,
        0,
      );
      assert.equal(
        (await db.query("SELECT media_path FROM uploads WHERE id=$1", [id]))
          .rows[0].media_path,
        "/fixture/video",
      );
    } finally {
      promises.rm = originalRm;
    }
    console.log(
      "PASS submitted videos retained despite expired legacy deletion deadline",
    );
    const cleanup = require("../lib/cleanup-file.ts");
    const fp = require("node:fs/promises"),
      oldRm = fp.rm;
    try {
      fp.rm = async () => {
        const e = new Error("denied");
        e.code = "EACCES";
        throw e;
      };
      assert.equal(
        await cleanup.removeForCleanup("/fixture/unsubmitted"),
        false,
      );
    } finally {
      fp.rm = oldRm;
    }
    console.log("PASS temporary cleanup reports deletion failure");
    await db.query(
      `INSERT INTO upload_sessions(id,uploader_open_id,uploader_name,original_filename,content_type,expected_size,chunk_size,total_chunks,media_path,status,expires_at)
      VALUES($1,'fixture-user','Fixture','video.mp4','video/mp4',1,1,1,'/fixture/video','failed',now()-interval '90 days')`,
      [id],
    );
    delete require.cache[path.join(root, "lib/upload-staging.ts")];
    assert.equal(
      await require("../lib/upload-staging.ts").cleanupExpiredUploadSessions(),
      0,
    );
    assert.equal(
      (
        await db.query("SELECT count(*) n FROM upload_sessions WHERE id=$1", [
          id,
        ])
      ).rows[0].n,
      "1",
    );
    console.log("PASS expired session cannot delete a submitted video");
    console.log("ALL RELIABILITY TESTS PASSED; no external calls made");
  } finally {
    await global.meedooPool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch((e) => {
  console.error(e.name, e.code || e.message);
  process.exitCode = 1;
});
