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
      },
    }).outputText,
    f,
  );
const {
  validateGeneration,
  estimateGenerationCost,
  normalizeGenerationUsage,
} = require("../lib/generation-model.ts");
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
for (const patch of [
  { duration: 0 },
  { duration: 16 },
  { duration: 4.5 },
  { resolution: "1080P" },
  { ratio: "adaptive" },
  { requirement: "" },
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
      previousKey = process.env.MINIMAX_API_KEY;
    global.meedooPool = isolated;
    global.meedooSchemaReady = undefined;
    process.env.MINIMAX_API_KEY = "test-only-fake-key";
    let calls = 0;
    try {
      const { query } = require("../lib/db.ts"),
        {
          createGeneration,
          generationList,
          refreshGeneration,
        } = require("../lib/generation.ts");
      await query(
        "INSERT INTO meedoo_users(open_id,name) VALUES('test-owner','Test Owner'),('test-other','Test Other')",
      );
      global.fetch = async (url, options) => {
        assert.ok(String(url).startsWith("https://api.minimax.cn/"));
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
      const uncertain = { ...base, requestId: randomUUID() };
      const uncertainId = await createGeneration(user, uncertain);
      assert.equal(await createGeneration(user, uncertain), uncertainId);
      assert.equal(calls, 2);
      own = await generationList(user.openId);
      assert.equal(
        own.tasks.find((x) => x.id === uncertainId).status,
        "submitted_unknown",
      );
      console.log(
        "PASS isolated DB: ownership, single paid submission per request, conflict rejection, missing token accounting, uncertain submission not retried",
      );
    } finally {
      global.fetch = previousFetch;
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
