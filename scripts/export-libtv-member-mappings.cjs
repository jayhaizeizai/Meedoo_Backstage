// One-time migration. Writes a new private file; never overwrites existing config or changes DB rows.
const { writeFile, mkdir } = require("node:fs/promises");
const { dirname } = require("node:path");
const { Pool } = require("pg");

(async () => {
  const target =
    process.env.LIBTV_MEMBER_MAPPINGS_FILE?.trim() ||
    "/etc/meedoo/libtv-member-mappings.json";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(`SELECT m.member_id, m.uploader_open_id,
      u.name uploader_name, e.member_name
      FROM libtv_member_mappings m
      LEFT JOIN meedoo_users u ON u.open_id=m.uploader_open_id
      LEFT JOIN LATERAL (SELECT COALESCE(NULLIF(member_alias,''),member_name) member_name
        FROM libtv_credit_entries WHERE member_id=m.member_id
        ORDER BY consumed_at DESC LIMIT 1) e ON true
      ORDER BY m.member_id`);
    if (result.rows.some((row) => !row.uploader_name))
      throw new Error("MAPPING_UPLOADER_NOT_FOUND");
    const mappings = result.rows.map((row) => ({
      memberId: row.member_id,
      memberName: row.member_name,
      uploaderOpenId: row.uploader_open_id,
      uploaderName: row.uploader_name,
    }));
    if (
      new Set(mappings.map((row) => row.uploaderOpenId)).size !==
      mappings.length
    )
      throw new Error("DUPLICATE_MAPPING_UPLOADER");
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(
      target,
      JSON.stringify({ version: 1, mappings }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Exported ${mappings.length} member mappings to ${target}`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(
    error.code === "EEXIST"
      ? "Config already exists; left unchanged."
      : "Mapping export failed.",
  );
  process.exitCode = 1;
});
