// Browser protocol regression: no real network, no provider calls, no database.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const {
  prepareVideoUpload,
} = require("../components/upload/upload-transport.ts");
const file = Object.assign(new Blob(["abcdefgh"]), {
  name: "fixture.mp4",
  lastModified: 1,
});
const text = (_zh, en) => en;
let sent = [],
  calls = [],
  failures = 0;
global.window = {
  localStorage: { setItem() {} },
  setTimeout: (callback) => setTimeout(callback, 0),
};
global.XMLHttpRequest = class {
  upload = {};
  open(method, url) {
    this.url = url;
  }
  setRequestHeader() {}
  send(chunk) {
    sent.push(this.url);
    if (failures-- > 0) {
      this.onerror();
      return;
    }
    this.status = 200;
    this.upload.onprogress?.({ lengthComputable: true, loaded: chunk.size });
    this.onload();
  }
};
async function run(status, received, failCount = 0) {
  sent = [];
  calls = [];
  failures = failCount;
  const stage = {
    id: "fixture",
    chunkSize: 4,
    totalChunks: 2,
    expectedSize: 8,
    receivedChunks: received,
    status,
  };
  global.fetch = async (url) => {
    calls.push(url);
    return Response.json(url.endsWith("/complete") ? {} : stage);
  };
  const progress = [];
  const result = await prepareVideoUpload(
    file,
    stage,
    () => {},
    (v) => progress.push(v),
    text,
  );
  return { result, progress };
}
(async () => {
  let output = await run("uploading", [0], 1);
  assert.equal(output.result.status, "ready");
  assert.deepEqual(sent, [
    "/api/uploads/fixture/chunks/1",
    "/api/uploads/fixture/chunks/1",
  ]);
  assert.deepEqual(output.result.receivedChunks, [0, 1]);
  assert.ok(output.progress.every((value) => value >= 0 && value <= 100));
  assert.equal(calls.filter((url) => url.endsWith("/complete")).length, 1);
  await run("ready", [0, 1]);
  assert.equal(sent.length, 0);
  assert.equal(calls.length, 1);
  await assert.rejects(() => run("used", [0, 1]), /already been used/);
  await assert.rejects(() => run("uploading", [], 3), /Connection interrupted/);
  assert.equal(sent.length, 3);
  assert.ok(!calls.some((url) => url.endsWith("/complete")));
  console.log(
    "PASS upload resume, completed-session reuse, chunk retry and exhausted-retry failure",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
