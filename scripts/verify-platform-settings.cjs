const assert = require("node:assert/strict");
const fs = require("node:fs"),
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
const {
  getEnabledPlatforms,
  platformSelectionEnabled,
} = require("../lib/platform-settings.ts");
const all = ["tiktok", "instagram", "youtube", "facebook", "x"];
const keys = [...all, "threads"].map((p) => `MEEDOO_PLATFORM_${p.toUpperCase()}_ENABLED`);
const saved = keys.map((k) => process.env[k]);
try {
  keys.forEach((k) => delete process.env[k]);
  assert.deepEqual(getEnabledPlatforms(), all);
  assert.equal(platformSelectionEnabled(all), true);
  process.env.MEEDOO_PLATFORM_FACEBOOK_ENABLED = "false";
  process.env.MEEDOO_PLATFORM_X_ENABLED = "0";
  assert.deepEqual(getEnabledPlatforms(), all.slice(0, 3));
  assert.equal(platformSelectionEnabled(all.slice(0, 3)), true);
  assert.equal(platformSelectionEnabled(all), false);
  assert.equal(platformSelectionEnabled(["tiktok", "instagram"]), false);
  assert.equal(
    platformSelectionEnabled(["tiktok", "instagram", "youtube", "youtube"]),
    false,
  );
  // Each platform can be disabled independently; malformed flags fail closed.
  for (const key of keys) {
    keys.forEach((k) => delete process.env[k]);
    process.env[key] = "typo";
    assert.equal(getEnabledPlatforms().length, key.includes("THREADS") ? 5 : 4);
  }
  keys.forEach((k) => delete process.env[k]);
  process.env.MEEDOO_PLATFORM_THREADS_ENABLED = "true";
  assert.deepEqual(getEnabledPlatforms(), [...all, "threads"]);
  assert.equal(platformSelectionEnabled(all), false);
  assert.equal(platformSelectionEnabled([...all, "threads"]), true);
  keys.forEach((k) => (process.env[k] = "false"));
  assert.equal(platformSelectionEnabled([]), false);
  console.log(
    "PASS runtime five/three/zero platform configuration and stale/disabled selection rejection",
  );
} finally {
  keys.forEach((k, i) =>
    saved[i] === undefined
      ? delete process.env[k]
      : (process.env[k] = saved[i]),
  );
}
