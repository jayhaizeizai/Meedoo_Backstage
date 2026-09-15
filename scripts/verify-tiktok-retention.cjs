// Unit fixtures by default; --db additionally uses an isolated TEST schema, never live records.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const ts = require("typescript"),
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
  computeTikTokRetention: compute,
  withTikTokRetention,
  tiktokRetentionScore,
  retentionVersion,
} = require("../lib/tiktok-retention.ts");
const curve = (fractions) => ({
  retention: fractions.map((percentage, second) => ({
    second: String(second),
    percentage,
  })),
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
close(compute(curve([1, 0.8, 0.6, 0.4]), 3).score, 70);
close(compute(curve([0.5, 0.5, 0.5, 0.5]), 3).score, 50);
close(compute(curve([0, 0, 0, 0]), 3).score, 0);
close(compute(curve([1, 0.8, 0.6, 0.4]), 2.5).score, 75);
const tail = compute(curve([1, 0.8, 0.6]), 2.5);
close(tail.score, 76); // (0.9 + 0.7 + 0.6 * 0.5) / 2.5 * 100
close(tail.estimatedTailSeconds, 0.5);
assert.equal(tail.segments[0].length, 3); // No fabricated plotted points.
assert.equal(tail.segments[0].at(-1).second, 2);
assert.equal(compute(curve([1, 0.8, 0.6]), 3).status, "incomplete_curve");
assert.equal(compute(curve([1, 0.8, 0.6]), 3.1).status, "incomplete_curve");
assert.equal(compute(curve([1]), 0.9).score, null);
assert.equal(
  compute(
    {
      retention: [
        { second: 0, percentage: 1 },
        { second: 2, percentage: 0.5 },
      ],
    },
    2.5,
  ).score,
  null,
);
close(compute(curve([0, 0]), 1.999).score, 0);
assert.equal(compute(curve([1, 1]), 1).estimatedTailSeconds, 0);
const observed = compute(
  curve(Array.from({ length: 35 }, () => 0.4)),
  34.922125,
);
close(observed.score, 40);
close(observed.estimatedTailSeconds, 0.922125);
const start = compute(
  {
    retention: [
      { second: "1", percentage: 0.5 },
      { second: "2", percentage: 0.5 },
    ],
  },
  2,
);
close(start.score, 62.5);
assert.equal(start.inferredStart, true);
assert.equal(start.segments[0][0].second, 1);
const separate = compute(
  { ...curve([1, 0.8, 0.6, 0.4]), full_video_watched_rate: 0.12 },
  3,
);
close(separate.threeSecondRate, 40);
close(separate.completionRate, 12);
assert.equal(
  compute({ average_time_watched: 3, full_video_watched_rate: 0.5 }, 4).score,
  null,
);
assert.equal(compute(curve([1, 0.8]), null).status, "missing_duration");
assert.equal(compute(curve([1, 0.8]), 2).status, "incomplete_curve");
assert.equal(
  compute(
    {
      retention: [
        { second: 2, percentage: 0.8 },
        { second: 3, percentage: 0.7 },
      ],
    },
    3,
  ).score,
  null,
);
const gap = compute(
  {
    retention: [
      { second: 0, percentage: 1 },
      { second: 2, percentage: 0.5 },
    ],
  },
  2,
);
assert.equal(gap.score, null);
assert.equal(gap.segments.length, 2);
for (const bad of [null, "", false, NaN, -1, 75, Infinity])
  assert.equal(
    compute({ retention: [{ second: 0, percentage: bad }] }, 1).status,
    "invalid_curve",
  );
assert.equal(
  compute(
    {
      retention: [
        { second: 0, percentage: 1 },
        { second: 0, percentage: 0.5 },
      ],
    },
    1,
  ).status,
  "invalid_curve",
);
const unsorted = curve(Array.from({ length: 12 }, () => 0.5));
unsorted.retention.reverse();
close(compute(unsorted, 11).score, 50);
close(compute(curve([0.4, 0.8, 0.5]), 2).score, 62.5); // Do not flatten replay-related rises.
assert.equal(
  tiktokRetentionScore("youtube", withTikTokRetention(curve([1, 1]), 1)),
  null,
);
assert.equal(tiktokRetentionScore("tiktok", curve([1, 1])), null); // Read paths require a stored score.
console.log(
  "PASS curve integration, clipping, fractions, gaps, missing values, zeros, and separate completion",
);

async function databaseTest() {
  assert.equal(process.env.LARK_APP_ID, "cli_aa1a6845a1f8de15");
  const { Pool } = require("pg"),
    schema = "retention_" + randomUUID().replaceAll("-", "");
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  global.meedooPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  global.fetch = async () => {
    throw new Error("UNEXPECTED_EXTERNAL_REQUEST");
  };
  const db = require("../lib/db.ts");
  try {
    await db.ensureSchema();
    await db.query(
      "INSERT INTO meedoo_users(open_id,name,role) VALUES('fixture','Fixture','approver')",
    );
    const id = randomUUID();
    await db.query(
      `INSERT INTO uploads(id,request_id,title,caption,profile_username,status,target_platforms,uploader_open_id,video_duration_seconds)
      VALUES($1,'fixture-request','Retention fixture','','fixture','completed',ARRAY['tiktok','youtube'],'fixture',3)`,
      [id],
    );
    const publications = await db.query(
      `INSERT INTO publications(upload_id,platform,status,platform_post_id)
      VALUES($1,'tiktok','completed','fixture-tt'),($1,'youtube','completed','fixture-yt') RETURNING id,platform`,
      [id],
    );
    const tt = publications.rows.find((p) => p.platform === "tiktok").id;
    const yt = publications.rows.find((p) => p.platform === "youtube").id;
    await db.query(
      "INSERT INTO metric_snapshots(publication_id,metrics) VALUES($1,$2::jsonb),($3,$4::jsonb)",
      [
        tt,
        JSON.stringify({
          ...curve([1, 0.8, 0.6, 0.4]),
          views: 100,
          full_video_watched_rate: 0.12,
        }),
        yt,
        JSON.stringify({ views: 900, average_view_percentage: 90 }),
      ],
    );
    const {
      backfillTikTokRetention,
    } = require("../lib/tiktok-retention-backfill.ts");
    assert.equal(await backfillTikTokRetention(), 1);
    assert.equal(await backfillTikTokRetention(), 0);
    const dashboard =
      await require("../lib/dashboard-data.ts").getDashboardData(30);
    close(dashboard.team.metrics.retention, 70); // YouTube's 900 views cannot affect this score.
    assert.equal(dashboard.people[0].scores.retention, null);
    assert.equal(dashboard.people[0].legacyWatchQuality.score, 17);
    const detail =
      await require("../lib/video-detail-data.ts").getVideoDetailData(id);
    close(detail.video.tiktokRetention[0].data.score, 70);
    close(detail.video.youtubeAverageViewPercentage, 90);
    await db.query(
      "UPDATE uploads SET video_duration_seconds=2.5 WHERE id=$1",
      [id],
    );
    assert.equal(await backfillTikTokRetention(), 1);
    close(
      (await require("../lib/video-detail-data.ts").getVideoDetailData(id))
        .video.tiktokRetention[0].data.score,
      75,
    );
    assert.equal(await backfillTikTokRetention(), 0);
    // Reprocess stored v1 missing-tail results, even when duration is unchanged.
    await db.query(
      "UPDATE uploads SET video_duration_seconds=3.5 WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE metric_snapshots SET metrics=jsonb_set(metrics,'{meedoo_tiktok_retention}',$2::jsonb) WHERE publication_id=$1",
      [
        tt,
        JSON.stringify({
          version: 1,
          duration: 3.5,
          status: "incomplete_curve",
          score: null,
        }),
      ],
    );
    assert.equal(await backfillTikTokRetention(), 1);
    const revised = (
      await db.query(
        "SELECT metrics FROM metric_snapshots WHERE publication_id=$1",
        [tt],
      )
    ).rows[0].metrics;
    assert.equal(revised.meedoo_tiktok_retention.version, retentionVersion);
    close(revised.meedoo_tiktok_retention.score, ((2.1 + 0.2) / 3.5) * 100);
    close(revised.meedoo_tiktok_retention.estimatedTailSeconds, 0.5);
    assert.equal(await backfillTikTokRetention(), 0);
    await db.query(
      "UPDATE uploads SET video_duration_seconds=2.5 WHERE id=$1",
      [id],
    );
    await backfillTikTokRetention();
    // Exercise the real sync insertion with a mocked read-only provider.
    const filename = path.resolve(__dirname, "../lib/upload-post.ts");
    require.cache[filename] = {
      id: filename,
      filename,
      loaded: true,
      exports: {
        getUploadPostConfig: () => ({ profile: "fixture" }),
        parseProviderResponse: (r) => r.json(),
        uploadPostFetch: async (url) => {
          const platform = new URL("https://fixture" + url).searchParams.get(
            "platform",
          );
          return new Response(
            JSON.stringify({
              platforms: {
                [platform]: {
                  post_metrics: { ...curve([1, 0.8, 0.6, 0.4]), views: 150 },
                },
              },
            }),
          );
        },
      },
    };
    assert.equal(
      await require("../lib/upload-post-sync.ts").syncAnalytics(),
      2,
    );
    const latest = await db.query(
      "SELECT metrics FROM metric_snapshots WHERE publication_id=$1 ORDER BY captured_at DESC,id DESC LIMIT 1",
      [tt],
    );
    close(tiktokRetentionScore("tiktok", latest.rows[0].metrics), 75);
    assert.equal(await backfillTikTokRetention(), 0);
    console.log(
      "PASS isolated DB: idempotent backfill, duration correction, sync persistence, platform separation, legacy bonus scoring",
    );
  } finally {
    await global.meedooPool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}
if (process.argv.includes("--db"))
  databaseTest().catch((e) => {
    console.error(e.name, e.code || e.message);
    process.exitCode = 1;
  });
