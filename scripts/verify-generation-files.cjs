const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { randomUUID } = require("node:crypto"),
  ts = require("typescript");
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  );
(async () => {
  assert.equal(process.env.LARK_APP_ID, "cli_aa1a6845a1f8de15", "TEST ONLY");
  const { Pool } = require("pg"),
    schema = "generation_files_test_" + randomUUID().replaceAll("-", "");
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  global.meedooPool = pool;
  global.meedooSchemaReady = undefined;
  const oldFetch = global.fetch,
    oldKey = process.env.MINIMAX_API_KEY;
  process.env.MINIMAX_API_KEY = "fake-files-key";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-files-test-"));
  try {
    const { query } = require("../lib/db.ts");
    const {
      generationSchema,
      createGeneration,
      prepareGeneration,
      refreshGeneration,
      generationList,
    } = require("../lib/generation.ts");
    const {
      minimaxImageReference,
    } = require("../lib/generation-minimax-files.ts");
    const { enqueueImageSync, processImageSync, imageSyncStatus, drainImageSyncQueue } = require("../lib/generation-image-sync.ts");
    await generationSchema();
    await query(
      "INSERT INTO meedoo_users(open_id,name) VALUES('file-owner','File Owner'),('file-other','File Other')",
    );
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i++) {
      const file = path.join(temp, ids[i] + ".png");
      fs.writeFileSync(file, i === 3 ? "different fixture" : "same fixture");
      await query(
        "INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,$2,$3,'image/png','fixture.png')",
        [ids[i], i === 2 ? "file-other" : "file-owner", file],
      );
    }
    let uploads = 0,
      paid = 0,
      failUpload = false,
      timeoutUpload = false,
      uncertain = false;
    global.fetch = async (url, options) => {
      if (String(url).endsWith("/v1/files/upload")) {
        uploads++;
        assert.equal(options.body.get("purpose"), "video_generation_input");
        assert.ok(options.body.get("file").size);
        if (timeoutUpload) throw new DOMException("simulated timeout", "TimeoutError");
        if (failUpload)
          return Response.json(
            { base_resp: { status_code: 2013 } },
            { status: 400 },
          );
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(
          '{"file":{"file_id":9007199254740993},"base_resp":{"status_code":0}}',
        );
      }
      if (String(url).endsWith("/v2/video_generation")) {
        paid++;
        const body = JSON.parse(options.body);
        for (const a of body.content.slice(1))
          assert.equal(a.image_url.url, "mm_file://9007199254740993");
        if (uncertain) throw Error("simulated timeout after paid submission");
        return Response.json({ task_id: "file-task-" + paid });
      }
      return Response.json({
        task: {
          id: "file-task-1",
          status: "failed",
          error: {
            code: "2013",
            message: "content[4].image_url: media url unreachable",
          },
        },
      });
    };
    assert.equal(
      await minimaxImageReference(ids[0], "file-owner"),
      "mm_file://9007199254740993",
    );
    assert.equal(
      await minimaxImageReference(ids[1], "file-owner"),
      "mm_file://9007199254740993",
    );
    assert.equal(uploads, 1);
    await assert.rejects(
      minimaxImageReference(ids[0], "file-other"),
      /INVALID_ASSETS/,
    );
    await minimaxImageReference(ids[2], "file-other");
    assert.equal(uploads, 2);
    await query(
      "UPDATE generation_minimax_files SET expires_at=now()-interval '1 second' WHERE owner_id='file-owner'",
    );
    await minimaxImageReference(ids[0], "file-owner");
    assert.equal(uploads, 3);
    process.env.MINIMAX_API_KEY = "rotated-files-key";
    const concurrent = await Promise.allSettled([
      minimaxImageReference(ids[0], "file-owner"),
      minimaxImageReference(ids[1], "file-owner"),
    ]);
    assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(uploads, 4);
    await minimaxImageReference(ids[1], "file-owner");
    assert.equal(uploads, 4);
    const user = { openId: "file-owner", name: "File Owner" };
    const input = {
      requestId: randomUUID(),
      requirement: "cache test",
      prompt: "A blue circle moves",
      mode: "reference",
      duration: 6,
      resolution: "768P",
      ratio: "9:16",
      assets: [
        { id: ids[0], role: "reference_image" },
        { id: ids[1], role: "reference_image" },
      ],
    };
    const id = await createGeneration(user, input);
    assert.equal(paid, 0);
    assert.equal(
      (await generationList(user.openId)).tasks[0].status,
      "preparing",
    );
    assert.equal(await createGeneration(user, input), id);
    await Promise.all([prepareGeneration(id), prepareGeneration(id)]);
    assert.equal(paid, 1);
    assert.equal(uploads, 4);
    await query(
      "UPDATE generation_tasks SET last_checked_at=NULL WHERE id=$1",
      [id],
    );
    await refreshGeneration(id, user.openId);
    assert.equal(
      (await generationList(user.openId)).tasks.find((t) => t.id === id)
        .error_code,
      "INPUT_MEDIA_UNREACHABLE",
    );
    failUpload = true;
    const failedId = await createGeneration(user, {
      ...input,
      requestId: randomUUID(),
      assets: [{ id: ids[3], role: "reference_image" }],
    });
    await prepareGeneration(failedId);
    await prepareGeneration(failedId);
    assert.equal(paid, 1);
    assert.equal(
      (await generationList(user.openId)).tasks.find((t) => t.id === failedId)
        .error_code,
      "INPUT_UPLOAD_FAILED",
    );
    failUpload = false;
    // A pre-upload job never generates video, retries transient errors at most three times,
    // and can be manually resumed without changing an existing failed generation task.
    await assert.rejects(enqueueImageSync(ids[3], "file-other", true), /NOT_FOUND/);
    await enqueueImageSync(ids[3], "file-owner", true);
    timeoutUpload = true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await query("UPDATE generation_image_sync SET next_attempt_at=now() WHERE asset_id=$1", [ids[3]]);
      await processImageSync(ids[3]);
      const state = await imageSyncStatus(ids[3], "file-owner");
      assert.equal(state.attempts, attempt);
      assert.equal(state.status, attempt === 3 ? "failed" : "retrying");
      assert.equal(state.error_code, "INPUT_UPLOAD_TIMEOUT");
    }
    assert.equal(paid, 1);
    timeoutUpload = false;
    await enqueueImageSync(ids[3], "file-owner", true);
    const beforeUploads = uploads;
    await Promise.all([processImageSync(ids[3]), processImageSync(ids[3])]);
    assert.equal(uploads, beforeUploads + 1);
    assert.equal((await imageSyncStatus(ids[3], "file-owner")).status, "ready");
    assert.equal(paid, 1);
    // Already-uploaded asset is ready before a generation request exists.
    uncertain = true;
    const uncertainId = await createGeneration(user, {
      ...input,
      requestId: randomUUID(),
    });
    await prepareGeneration(uncertainId);
    await prepareGeneration(uncertainId);
    assert.equal(paid, 2);
    assert.equal(
      (await generationList(user.openId)).tasks.find(
        (t) => t.id === uncertainId,
      ).status,
      "submitted_unknown",
    );
    // Mock Ark HTTPS transport; no paid provider request leaves this test.
    const https = require('node:https'), originalRequest = https.request;
    https.request = (url, options, callback) => {
      const req = new (require('node:events').EventEmitter)();
      req.end = async () => {
        try {
          const result = await global.fetch(url, options);
          const res = new (require('node:stream').PassThrough)();
          res.statusCode = result.status; res.headers = {};
          callback(res); res.end(Buffer.from(await result.arrayBuffer()));
        } catch (e) { req.emit('error', e); }
      };
      return req;
    };
    // Seedance is queued before any network call; two workers submit only once.
    process.env.ARK_API_KEY = "fake-ark-key";
    await query("INSERT INTO meedoo_users(open_id,name) VALUES('ark-owner','Ark Owner')");
    let arkCalls = 0;
    const originalTimeout = AbortSignal.timeout, limits = [];
    AbortSignal.timeout = (ms) => { limits.push(ms); return originalTimeout(ms); };
    global.fetch = async (url) => {
      assert.ok(String(url).endsWith('/contents/generations/tasks'));
      arkCalls++;
      return Response.json({ id: 'ark-test-id' });
    };
    const arkInput = { ...input, model: 'seedance-2.0-fast', requestId: randomUUID(), assets: [], mode: 'reference', resolution: '720p' };
    const arkUser = { openId: 'ark-owner', name: 'Ark Owner' };
    try {
      const arkId = await createGeneration(arkUser, arkInput);
      assert.equal(arkCalls, 0);
      assert.equal((await query("SELECT status FROM generation_tasks WHERE id=$1", [arkId])).rows[0].status, 'preparing');
      await Promise.all([prepareGeneration(arkId), prepareGeneration(arkId)]);
      assert.equal(arkCalls, 1);
      assert.ok(limits.includes(600000));
      assert.equal((await query("SELECT status FROM generation_tasks WHERE id=$1", [arkId])).rows[0].status, 'queued');
      assert.equal(await createGeneration(arkUser, arkInput), arkId);
      global.fetch = async () => { arkCalls++; throw new DOMException('simulated', 'TimeoutError'); };
      const unknown = await createGeneration(arkUser, { ...arkInput, requestId: randomUUID() });
      await prepareGeneration(unknown);
      await prepareGeneration(unknown);
      assert.equal(arkCalls, 2);
      assert.equal((await query("SELECT status FROM generation_tasks WHERE id=$1", [unknown])).rows[0].status, 'submitted_unknown');
    } finally { AbortSignal.timeout = originalTimeout; https.request = originalRequest; }
    const parallelIds = [];
    for (let i = 0; i < 8; i++) {
      const id = randomUUID(), file = path.join(temp, id + ".png");
      fs.writeFileSync(file, "parallel fixture " + i);
      await query("INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,'file-owner',$2,'image/png','parallel.png')", [id, file]);
      await enqueueImageSync(id, "file-owner");
      parallelIds.push(id);
    }
    let active = 0, peak = 0, started = 0;
    const releases = [];
    global.fetch = async (url) => {
      assert.ok(String(url).endsWith('/v1/files/upload'), 'No generation calls in image workers');
      started++; active++; peak = Math.max(peak, active);
      const fileId = 'parallel-' + started;
      await new Promise((resolve) => releases.push(resolve));
      active--;
      return Response.json({ file: { file_id: fileId }, base_resp: { status_code: 0 } });
    };
    const until = async (condition) => {
      const expires = Date.now() + 5000;
      while (!condition()) {
        assert.ok(Date.now() < expires, 'Concurrent queue stalled');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const drain = drainImageSyncQueue();
    assert.equal(drainImageSyncQueue(), drain, 'Coalesce duplicate callbacks');
    try {
      await until(() => started === 5);
      assert.equal(peak, 5);
      // A cached asset becomes ready even while all five transfer slots are occupied.
      assert.equal((await enqueueImageSync(ids[1], 'file-owner')).status, 'ready');
      const waiting = (await query("SELECT asset_id FROM generation_image_sync WHERE asset_id=ANY($1::uuid[]) AND status='pending'", [parallelIds])).rows[0].asset_id;
      assert.equal(await processImageSync(waiting), false, 'Sixth independent request cannot exceed global cap');
      releases.shift()();
      await until(() => started === 6);
      assert.equal(active, 5, 'Refill freed slot without waiting for the other four');
      while (started < 8 || active) {
        for (const release of releases.splice(0)) release();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await drain;
      assert.equal(peak, 5);
      assert.equal(started, 8);
      for (const id of parallelIds) assert.equal((await imageSyncStatus(id, 'file-owner')).status, 'ready');
    } finally {
      // Release all simulated uploads even when an assertion fails.
      const releaser = setInterval(() => { for (const release of releases.splice(0)) release(); }, 10);
      await drain.finally(() => clearInterval(releaser));
    }
    // A >30 MB video and audio upload before generation, using platform file IDs only.
    await query("INSERT INTO meedoo_users(open_id,name) VALUES('media-owner','Media Owner')");
    const mediaOwner = { openId: 'media-owner', name: 'Media Owner' };
    const videoId = randomUUID(), audioId = randomUUID();
    for (const [id, mime, bytes] of [[videoId, 'video/mp4', Buffer.alloc(31 * 1024 * 1024, 1)], [audioId, 'audio/wav', Buffer.from('audio fixture')]]) {
      const f = path.join(temp, id); fs.writeFileSync(f, bytes);
      await query("INSERT INTO generation_assets(id,owner_id,path,mime,filename,media_duration,expires_at) VALUES($1,'media-owner',$2,$3,'media',5,now()+interval '14 days')", [id, f, mime]);
    }
    let mediaUploads = 0, mediaGenerations = 0;
    global.fetch = async (url, options) => {
      if (String(url).endsWith('/v1/files/upload')) {
        mediaUploads++;
        assert.equal(options.body.get('purpose'), 'video_generation_input');
        assert.ok(['video/mp4', 'audio/wav'].includes(options.body.get('file').type));
        return Response.json({ file: { file_id: 'media-' + mediaUploads }, base_resp: { status_code: 0 } });
      }
      assert.ok(String(url).endsWith('/v2/video_generation'));
      const body = JSON.parse(options.body);
      assert.equal(body.content[1].type, 'video_url');
      assert.equal(body.content[2].type, 'audio_url');
      for (const c of body.content.slice(1)) assert.match(c[c.type].url, /^mm_file:\/\//);
      mediaGenerations++;
      return Response.json({ task_id: 'media-task-' + mediaGenerations });
    };
    const mediaInput = { ...input, requestId: randomUUID(), assets: [{ id: videoId, role: 'reference_video' }, { id: audioId, role: 'reference_audio' }] };
    const mediaTask = await createGeneration(mediaOwner, mediaInput);
    assert.equal(mediaGenerations, 0);
    await Promise.all([prepareGeneration(mediaTask), prepareGeneration(mediaTask)]);
    assert.equal(mediaUploads, 2); assert.equal(mediaGenerations, 1);
    const cachedTask = await createGeneration(mediaOwner, { ...mediaInput, requestId: randomUUID() });
    await prepareGeneration(cachedTask);
    assert.equal(mediaUploads, 2); assert.equal(mediaGenerations, 2);
    await assert.rejects(enqueueImageSync(videoId, 'file-other'), /NOT_FOUND/);
    const badVideo = randomUUID(), badPath = path.join(temp, badVideo);
    fs.writeFileSync(badPath, 'bad video upload');
    await query("INSERT INTO generation_assets(id,owner_id,path,mime,filename,media_duration) VALUES($1,'media-owner',$2,'video/mp4','bad',5)", [badVideo,badPath]);
    global.fetch = async (url) => { assert.ok(String(url).endsWith('/v1/files/upload')); return Response.json({base_resp:{status_code:2013}}, {status:400}); };
    const badTask = await createGeneration(mediaOwner, { ...mediaInput, requestId: randomUUID(), assets:[{id:badVideo,role:'reference_video'}] });
    await prepareGeneration(badTask);
    assert.equal((await query("SELECT status,error_code FROM generation_tasks WHERE id=$1",[badTask])).rows[0].error_code, 'INPUT_UPLOAD_FAILED');
    assert.equal(mediaGenerations, 2);
    console.log('PASS video/audio platform uploads, >30MB video, cache reuse, ownership, no public URL fallback or paid submission on upload failure');
    console.log('PASS five-slot global cap, immediate slot refill, cache hit while saturated, coalesced callbacks, eight files drained without timer');
    console.log(
      "PASS file cache: int64 IDs, content deduplication, owner isolation, key rotation, expiry, concurrent upload and submission locks, durable preparation, no paid call after upload failure, no ambiguous resubmission, readable failure code",
    );
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = oldKey;
    await pool.end();
    global.meedooPool = undefined;
    global.meedooSchemaReady = undefined;
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    for (const f of fs.readdirSync(temp)) fs.unlinkSync(path.join(temp, f));
    fs.rmdirSync(temp);
  }
})().catch((e) => {
  console.error(e.name, e.message);
  process.exitCode = 1;
});
