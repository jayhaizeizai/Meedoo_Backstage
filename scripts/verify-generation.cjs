const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ts = require("typescript"),
  { randomUUID } = require("node:crypto");
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
const {
  validateGeneration,
  estimateGenerationCost,
  normalizeGenerationUsage,
} = require("../lib/generation-model.ts");
const { safeProviderDiagnostic } = require("../lib/generation-provider.ts");
assert.deepEqual(safeProviderDiagnostic({error:{code:"InvalidParameter",message:"The parameter `content[2].image_url` is invalid: https://private/image?token=secret Request id: test-123"}}), {code:"InvalidParameter",request_id:"test-123",parameter:"content[2].image_url"});
assert.deepEqual(safeProviderDiagnostic({error:{code:"Bearer secret",message:"prompt contains private text"},request_id:"https://private"}), {code:undefined,request_id:undefined,parameter:undefined});
assert.equal(safeProviderDiagnostic({error:{code:"ModelNotOpen"}},"trace-1").code,"ModelNotOpen");
const { seedanceErrorReason } = require("../lib/generation-error-reasons.ts");
const { shouldRenewGenerationRequest } = require("../lib/generation-model.ts");
assert.match(seedanceErrorReason("InputImageSensitiveContentDetected.PrivacyInformation")[0], /真人/);
assert.match(seedanceErrorReason("InputImageSensitiveContentDetected.PrivacyInformation")[1], /real person/);
assert.match(seedanceErrorReason("OutputVideoSensitiveContentDetected.PolicyViolation")[0], /版权/);
assert.match(seedanceErrorReason("OutputVideoSensitiveContentDetected")[0], /生成的视频/);
assert.match(seedanceErrorReason("ModelNotOpen")[0], /尚未开通/);
assert.match(seedanceErrorReason("InvalidParameter.TaskTypeMismatch")[0], /任务类型/);
assert.match(seedanceErrorReason("NewUnknownError")[0], /尚未收录/);
for (const status of [undefined, "queued", "running", "preparing", "submitting", "submitted_unknown", "succeeded"])
  assert.equal(shouldRenewGenerationRequest("same", "same", status), false);
for (const status of ["failed", "cancelled"])
  assert.equal(shouldRenewGenerationRequest("same", "same", status), true);
assert.equal(shouldRenewGenerationRequest("old", "new", "failed"), true);
const base = {
  requestId: randomUUID(),
  requirement: "Episode 1",
  prompt: "A small dog runs across the room.",
  mode: "reference",
  duration: 6,
  resolution: "768P",
  ratio: "9:16",
  assets: [],
};
assert.equal(validateGeneration(base).duration, 6);
for (const model of ["seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini", "seedance-2.5"]) {
  const max = model === "seedance-2.5" ? 30 : 15;
  for (const duration of [4,max]) assert.equal(validateGeneration({...base,model,duration,resolution:"720p"}).duration,duration);
  for (const duration of [3,4.5,max+1]) assert.throws(()=>validateGeneration({...base,model,duration,resolution:"720p"}),/INVALID_INPUT/);
}

assert.equal(validateGeneration({ ...base, requirement: undefined }).requirement, base.prompt);
assert.equal(validateGeneration({ ...base, requirement: " " }).requirement, base.prompt);
assert.equal(validateGeneration({ ...base, requirement: undefined, prompt: "🐶".repeat(50) }).requirement, "🐶".repeat(40) + "…");
assert.equal(validateGeneration({ ...base, requirement: undefined, prompt: "  A\n  dog  " }).requirement, "A dog");
assert.equal(validateGeneration(base).requirement, "Episode 1");
for (const patch of [
  { duration: 0 },
  { duration: 16 },
  { duration: 4.5 },
  { resolution: "1080P" },
  { ratio: "adaptive" },
  { requirement: 42 },
  { prompt: "" },
  { requestId: "invalid" },
  { mode: "frames" },
  {
    assets: Array.from({ length: 10 }, () => ({
      id: randomUUID(),
      role: "reference_image",
    })),
  },
])
  assert.throws(() => validateGeneration({ ...base, ...patch }));
const image = { id: randomUUID(), role: "first_frame" };
assert.equal(
  validateGeneration({ ...base, mode: "frames", assets: [image] }).assets
    .length,
  1,
);
assert.throws(() => validateGeneration({ ...base, assets: [image] }));
assert.throws(() =>
  validateGeneration({
    ...base,
    mode: "frames",
    assets: [image, { id: randomUUID(), role: "reference_image" }],
  }),
);
assert.throws(() =>
  validateGeneration({
    ...base,
    assets: [
      { ...image, role: "reference_image" },
      { ...image, role: "reference_image" },
    ],
  }),
);
assert.equal(estimateGenerationCost(6, "768P", 5), 3);
assert.equal(estimateGenerationCost(6, "2K", 9), 5.6);
assert.deepEqual(normalizeGenerationUsage(null), {});
assert.deepEqual(
  normalizeGenerationUsage({
    total_tokens: null,
    output_seconds: 6,
    completion_tokens: -1,
    prompt_tokens: "12",
    secret: "do not store",
  }),
  { output_seconds: 6 },
);
assert.deepEqual(
  normalizeGenerationUsage({
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  }),
  { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 },
);
const references = Array.from({ length: 30 }, () => ({
  id: randomUUID(),
  role: "reference_image",
}));
assert.equal(
  validateGeneration({
    ...base,
    model: "seedance-2.5",
    resolution: "720p",
    duration: 30,
    assets: references,
  }).assets.length,
  30,
);
for (const patch of [
  { model: "unknown" },
  { model: "seedance-2.0", resolution: "2K" },
  { model: "seedance-2.0", resolution: "720p", duration: 16 },
  { model: "seedance-2.5", resolution: "720p", duration: 31 },
  { model: "seedance-2.0", resolution: "720p", assets: references },
  { model: "seedance-2.5", resolution: "720p", generateAudio: "yes" },
])
  assert.throws(() => validateGeneration({ ...base, ...patch }));
console.log(
  "PASS generation input/mode validation, duplicate assets, China pricing, missing versus zero usage",
);

if (process.argv.includes("--db"))
  void (async () => {
    assert.equal(process.env.LARK_APP_ID, "cli_aa1a6845a1f8de15", "TEST ONLY");
    const { Pool } = require("pg"),
      schema = "generation_test_" + randomUUID().replaceAll("-", "");
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const isolated = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    const previousFetch = global.fetch,
      previousKey = process.env.MINIMAX_API_KEY,
      previousArk = process.env.ARK_API_KEY;
    global.meedooPool = isolated;
    global.meedooSchemaReady = undefined;
    process.env.MINIMAX_API_KEY = "test-only-fake-key";
    process.env.ARK_API_KEY = "test-only-fake-ark";
    let calls = 0;
    try {
      const { query } = require("../lib/db.ts"),
        {
          permittedOutput,
          cleanupGenerationOutputs,
          createGeneration,
          generationList,
          refreshGeneration,
        } = require("../lib/generation.ts");
      await query(
        "INSERT INTO meedoo_users(open_id,name) VALUES('test-owner','Test Owner'),('test-other','Test Other')",
      );
      global.fetch = async (url, options) => {
        assert.ok(String(url).startsWith("https://api.minimaxi.com/"));
        if (options.method === "POST") {
          calls++;
          return new Response(JSON.stringify({ task_id: "test-provider-1" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            task: {
              id: "test-provider-1",
              status: "succeeded",
              usage: { output_seconds: 6 },
              content: {},
            },
          }),
          { status: 200 },
        );
      };
      const user = { openId: "test-owner", name: "Test Owner" };
      const id = await createGeneration(user, base);
      assert.equal(await createGeneration(user, base), id);
      assert.equal(calls, 1);
      await assert.rejects(
        createGeneration(user, { ...base, prompt: "Changed" }),
        /REQUEST_CONFLICT/,
      );
      await assert.rejects(refreshGeneration(id, "test-other"), /NOT_FOUND/);
      await refreshGeneration(id, "test-owner");
      let own = await generationList(user.openId);
      assert.equal(own.tasks.length, 1);
      assert.equal(own.tasks[0].status, "succeeded");
      assert.equal(own.tasks[0].usage.total_tokens, undefined);
      assert.equal(own.summary[0].missing_tokens, 1);
      assert.equal(own.summary[0].tokens, null);
      assert.equal((await generationList("test-other")).tasks.length, 0);
      global.fetch = async () => {
        calls++;
        throw Error("Simulated timeout");
      };
      const uncertain = { ...base, requirement: undefined, requestId: randomUUID() };
      const uncertainId = await createGeneration(user, uncertain);
      assert.equal(await createGeneration(user, uncertain), uncertainId);
      assert.equal(calls, 2);
      own = await generationList(user.openId);
      assert.equal(
        own.tasks.find((x) => x.id === uncertainId).status,
        "submitted_unknown",
      );
      await query("UPDATE meedoo_users SET role='approver' WHERE open_id='test-other'");
      const otherApprover = await generationList("test-other");
      assert.equal(otherApprover.approver, true);
      assert.deepEqual(otherApprover.tasks, []);
      assert.deepEqual(otherApprover.summary, []);
      await query("UPDATE meedoo_users SET role='approver' WHERE open_id='test-owner'");
      assert.ok((await generationList(user.openId)).tasks.some(t => t.id === id));
      let rejectedPosts = 0;
      global.fetch = async () => { rejectedPosts++; return Response.json({error:{code:"InputImageSensitiveContentDetected.PrivacyInformation", message:"private input https://private?token=secret Request id: review-123"}}, {status:400}); };
      const failedInput = {...base,requestId:randomUUID(),model:"seedance-2.0-fast",resolution:"720p"};
      const failedId = await createGeneration(user,failedInput);
      assert.equal(await createGeneration(user,failedInput),failedId);
      assert.equal(rejectedPosts,1);
      const failedTask = (await generationList(user.openId)).tasks.find(t=>t.id===failedId);
      assert.equal(failedTask.provider_error.code,"InputImageSensitiveContentDetected.PrivacyInformation");
      assert.equal(failedTask.provider_error.request_id,"review-123");
      assert.ok(!JSON.stringify(failedTask.provider_error).includes("secret"));
      assert.equal(shouldRenewGenerationRequest("same","same",failedTask.status),true);
      const retryInput={...failedInput,requestId:randomUUID()};
      const retryId=await createGeneration(user,retryInput);
      assert.notEqual(retryId,failedId);
      assert.equal(await createGeneration(user,retryInput),retryId);
      assert.equal(rejectedPosts,2);
      global.fetch=async (_url,options)=>options.method === "POST"
        ? Response.json({id:"async-rejection"})
        : Response.json({id:"async-rejection",status:"failed",error:{code:"OutputVideoSensitiveContentDetected.PolicyViolation",message:"private output text"}},{headers:{"x-request-id":"async-review-123"}});
      const asyncId=await createGeneration(user,{...failedInput,requestId:randomUUID()});
      await refreshGeneration(asyncId,user.openId);
      const asyncTask=(await generationList(user.openId)).tasks.find(t=>t.id===asyncId);
      assert.equal(asyncTask.status,"failed");
      assert.equal(asyncTask.provider_error.code,"OutputVideoSensitiveContentDetected.PolicyViolation");
      assert.equal(asyncTask.provider_error.request_id,"async-review-123");
      assert.ok(!JSON.stringify(asyncTask.provider_error).includes("private output"));
      console.log("PASS own-only approver history/totals; safe submit and asynchronous errors; explicit failed retry with deduplication");
      const path = require("node:path"),
        os = require("node:os");
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "generation-expiry-"));
      const oldMedia = process.env.MEEDOO_MEDIA_DIR;
      process.env.MEEDOO_MEDIA_DIR = temp;
      const folder = path.join(temp, "generation");
      fs.mkdirSync(folder);
      const output = path.join(folder, `${id}.mp4`);
      const upload = path.join(temp, "uploaded.mp4");
      const reference = path.join(folder, "reference.image");
      fs.writeFileSync(output, "fixture");
      fs.writeFileSync(upload, "keep upload");
      fs.writeFileSync(reference, "keep reference");
      try {
        await query(
          "UPDATE generation_tasks SET media_path=$2,media_expires_at=now()+interval '1 day' WHERE id=$1",
          [id, output],
        );
        await cleanupGenerationOutputs();
        assert.ok(fs.existsSync(output));
        await query(
          "UPDATE generation_tasks SET media_expires_at=now()-interval '1 second',media_path=$2 WHERE id=$1",
          [id, upload],
        );
        await cleanupGenerationOutputs();
        assert.ok(fs.existsSync(upload));
        assert.equal(
          (
            await query(
              "SELECT media_deleted_at FROM generation_tasks WHERE id=$1",
              [id],
            )
          ).rows[0].media_deleted_at,
          null,
        );
        await query("UPDATE generation_tasks SET media_path=$2 WHERE id=$1", [
          id,
          output,
        ]);
        own = await generationList(user.openId);
        assert.equal(own.tasks.find((t) => t.id === id).expired, true);
        assert.equal(own.tasks.find((t) => t.id === id).available, false);
        await cleanupGenerationOutputs();
        await cleanupGenerationOutputs();
        assert.equal(fs.existsSync(output), false);
        assert.ok(fs.existsSync(upload) && fs.existsSync(reference));
        const before = calls;
        await refreshGeneration(id, user.openId);
        assert.equal(
          calls,
          before,
          "expired output must never be fetched again",
        );
        const retained = (await generationList(user.openId)).tasks.find(
          (t) => t.id === id,
        );
        assert.equal(retained.status, "succeeded");
        assert.equal(retained.usage.output_seconds, 6);
        assert.equal(retained.expired, true);
        console.log(
          "PASS expiry: deadline, narrow deletion, retained usage, idempotence, no re-download",
        );
      } finally {
        if (oldMedia === undefined) delete process.env.MEEDOO_MEDIA_DIR;
        else process.env.MEEDOO_MEDIA_DIR = oldMedia;
        for (const file of [output, upload, reference])
          fs.rmSync(file, { force: true });
        fs.rmdirSync(folder);
        fs.rmdirSync(temp);
      }
      // Legacy H3 records without a model field still deduplicate against the new input.
      await query(
        "UPDATE generation_tasks SET input=input-'model' WHERE id=$1",
        [id],
      );
      assert.equal(await createGeneration(user, base), id);
      const arkHost =
        "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/video.mp4";
      for (const bad of [
        "http://127.0.0.1/video",
        "https://evil.example/video",
        "https://other.tos-cn-beijing.volces.com/video",
        "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com.evil.example/video",
      ]) {
        assert.throws(() => permittedOutput(bad, "seedance-2.5"));
      }
      assert.equal(
        permittedOutput(arkHost, "seedance-2.0").hostname,
        new URL(arkHost).hostname,
      );
      const outputRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "seedance-storage-"),
      );
      const previousMedia = process.env.MEEDOO_MEDIA_DIR;
      process.env.MEEDOO_MEDIA_DIR = outputRoot;
      const fixture = path.join(outputRoot, "fixture.mp4");
      const savedIds = [];
      try {
        require("node:child_process").execFileSync("ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=256x256:d=1",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          fixture,
        ]);
        let posted = 0,
          payload;
        global.fetch = async (url, options) => {
          if (String(url) === arkHost)
            return new Response(fs.readFileSync(fixture), {
              headers: { "Content-Type": "video/mp4" },
            });
          assert.ok(
            String(url).startsWith(
              "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
            ),
          );
          assert.equal(
            options.headers.Authorization,
            "Bearer test-only-fake-ark",
          );
          if (options.method === "POST") {
            posted++;
            payload = JSON.parse(options.body);
            return Response.json({ id: "ark-provider-" + posted });
          }
          return Response.json({
            id: "ark-provider-" + posted,
            status: "succeeded",
            content: { video_url: arkHost },
            duration: 6,
            usage: { total_tokens: 1234, completion_tokens: 1234 },
          });
        };
        for (const [alias, apiModel] of [
          ["seedance-2.0", "doubao-seedance-2-0-260128"],
          ["seedance-2.5", "doubao-seedance-2-5-260628"],
          ["seedance-2.0-fast", "doubao-seedance-2-0-fast-260128"],
          ["seedance-2.0-mini", "doubao-seedance-2-0-mini-260615"],
        ]) {
          const input = {
            ...base,
            requestId: randomUUID(),
            model: alias,
            resolution: "720p",
            generateAudio: false,
          };
          const seedId = await createGeneration(user, input);
          savedIds.push(seedId);
          assert.equal(await createGeneration(user, input), seedId);
          assert.equal(payload.model, apiModel);
          assert.equal(payload.generate_audio, false);
          assert.equal(payload.resolution, "720p");
          await assert.rejects(
            createGeneration(user, { ...input, generateAudio: true }),
            /REQUEST_CONFLICT/,
          );
          await assert.rejects(
            createGeneration(user, {
              ...input,
              model: alias === "seedance-2.0" ? "seedance-2.5" : "seedance-2.0",
            }),
            /REQUEST_CONFLICT/,
          );
          await refreshGeneration(seedId, user.openId);
          const t = (await generationList(user.openId)).tasks.find(
            (t) => t.id === seedId,
          );
          assert.equal(t.available, true);
          assert.equal(t.usage.total_tokens, 1234);
          assert.equal(t.estimated_cost, null);
          const remaining = new Date(t.media_expires_at).getTime() - Date.now();
          assert.ok(remaining > 13.99 * 86400000 && remaining <= 14 * 86400000);
          assert.ok(
            fs.statSync(path.join(outputRoot, "generation", seedId + ".mp4"))
              .size > 0,
          );
        }
        assert.equal(posted, 4);
        console.log(
          "PASS Seedance 2.0/Fast/Mini/2.5: provider routing, immutable model/audio, one submission, real file storage, returned tokens, 14-day deadline; MiniMax legacy compatibility",
        );
      } finally {
        if (previousMedia === undefined) delete process.env.MEEDOO_MEDIA_DIR;
        else process.env.MEEDOO_MEDIA_DIR = previousMedia;
        for (const seedId of savedIds)
          fs.rmSync(path.join(outputRoot, "generation", seedId + ".mp4"), {
            force: true,
          });
        fs.rmSync(fixture, { force: true });
        if (fs.existsSync(path.join(outputRoot, "generation")))
          fs.rmdirSync(path.join(outputRoot, "generation"));
        fs.rmdirSync(outputRoot);
      }
      console.log(
        "PASS isolated DB: ownership, single paid submission per request, conflict rejection, missing token accounting, uncertain submission not retried",
      );
    } finally {
      global.fetch = previousFetch;
      if (previousArk === undefined) delete process.env.ARK_API_KEY;
      else process.env.ARK_API_KEY = previousArk;
      if (previousKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = previousKey;
      await isolated.end();
      global.meedooPool = undefined;
      global.meedooSchemaReady = undefined;
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  })().catch((e) => {
    console.error(e.name, e.message);
    process.exitCode = 1;
  });
