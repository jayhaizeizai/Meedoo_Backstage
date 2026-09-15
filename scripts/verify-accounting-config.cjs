const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
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
function mock(name, exports) {
  const f = path.join(root, name);
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
}
let writes = 0;
mock("lib/db.ts", {
  query: async (sql) => {
    if (!sql.trim().startsWith("SELECT")) {
      writes++;
      throw Error("UNEXPECTED_WRITE");
    }
    let rows;
    if (sql.includes("libtv_member_mappings"))
      throw Error("LEGACY_MAPPING_READ");
    if (sql.includes("DISTINCT to_char")) rows = [{ week_start: "2026-09-07" }];
    else if (sql.includes("libtv_accounting_settings"))
      rows = [
        {
          package_points: 16300,
          package_cost_cny: "649",
          updated_at: "2026-09-14",
        },
      ];
    else if (sql.includes("meedoo_users"))
      rows = [
        { open_id: "user-a", name: "Renamed user" },
        { open_id: "user-b", name: "Other user" },
      ];
    else if (sql.includes("libtv_credit_entries"))
      rows = [
        {
          member_id: "member-a",
          member_name: "Haniya",
          member_alias: null,
          entry_type: "creation",
          model: "video",
          points: -16300,
        },
      ];
    else if (sql.includes("FROM uploads"))
      rows = [
        {
          id: "video-a",
          title: "First",
          uploader_open_id: "user-a",
          uploader_name: "Old display name",
        },
        {
          id: "video-b",
          title: "Second",
          uploader_open_id: "user-a",
          uploader_name: "Old display name",
        },
        {
          id: "video-c",
          title: "Unmapped",
          uploader_open_id: "user-b",
          uploader_name: "Haniya",
        },
      ];
    else throw Error("UNEXPECTED_QUERY");
    return { rows, rowCount: rows.length };
  },
  transaction: () => {
    throw Error("UNEXPECTED_TRANSACTION");
  },
});
const { loadLibTvMemberMappings } = require("../lib/libtv-member-config.ts");
const { getLibTvAccounting } = require("../lib/libtv-accounting.ts");
(async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "meedoo-accounting-config-"),
  );
  const file = path.join(dir, "mapping.json");
  const old = process.env.LIBTV_MEMBER_MAPPINGS_FILE;
  process.env.LIBTV_MEMBER_MAPPINGS_FILE = file;
  const save = (mappings) =>
    fs.writeFileSync(file, JSON.stringify({ version: 1, mappings }));
  try {
    await assert.rejects(loadLibTvMemberMappings(), /CONFIG_UNREADABLE/);
    save([
      {
        memberId: "member-a",
        uploaderOpenId: "user-a",
        memberName: "Renamed alias",
      },
    ]);
    let data = await getLibTvAccounting("2026-09-07");
    assert.equal(data.members[0].videoCount, 2);
    assert.equal(data.members[0].mappedUploaderName, "Renamed user");
    assert.equal(data.members[0].costCny, 649);
    assert.equal(data.videos[0].allocatedCostCny, 324.5);
    assert.equal(data.videos[0].libtvMemberId, "member-a");
    assert.equal(data.videos[2].allocatedCostCny, null);
    save([]);
    data = await getLibTvAccounting("2026-09-07");
    assert.equal(data.members[0].videoCount, 0);
    assert.equal(data.videos[2].allocatedCostCny, null);
    assert.equal(data.totals.costCny, 649);
    save([{ memberId: "member-a", uploaderOpenId: "missing-user" }]);
    await assert.rejects(getLibTvAccounting(), /UPLOADER_NOT_FOUND/);
    for (const mappings of [
      [
        { memberId: "a", uploaderOpenId: "u" },
        { memberId: "a", uploaderOpenId: "v" },
      ],
      [
        { memberId: "a", uploaderOpenId: "u" },
        { memberId: "b", uploaderOpenId: "u" },
      ],
      [{ memberId: "0", uploaderOpenId: "u" }],
      [{ memberId: 123, uploaderOpenId: "u" }],
      [{ memberId: "a", uploaderOpenId: "" }],
    ]) {
      save(mappings);
      await assert.rejects(loadLibTvMemberMappings(), /CONFIG_INVALID/);
    }
    fs.writeFileSync(file, "{broken");
    await assert.rejects(loadLibTvMemberMappings(), /CONFIG_UNREADABLE/);
    mock("lib/server-auth.ts", {
      getCurrentUser: async () => ({ openId: "user-a", name: "Approver" }),
    });
    mock("lib/approvals.ts", { isApprover: async () => true });
    const { POST } = require("../app/api/weekly-report/accounting/route.ts");
    const form = new FormData();
    form.set("action", "map");
    form.set("memberId", "member-a");
    form.set("uploaderOpenId", "user-b");
    const response = await POST(
      new Request("http://localhost/api/weekly-report/accounting", {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "ACCOUNTING_ACTION_DISABLED");
    assert.equal(writes, 0);
    console.log(
      "PASS file-only ID mapping, renamed users, allocation, immediate reload, no name fallback, invalid configs, retired write API",
    );
  } finally {
    if (old === undefined) delete process.env.LIBTV_MEMBER_MAPPINGS_FILE;
    else process.env.LIBTV_MEMBER_MAPPINGS_FILE = old;
    assert.equal(path.dirname(dir), os.tmpdir());
    fs.rmSync(dir, { recursive: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
