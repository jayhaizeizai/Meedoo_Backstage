// Run on the test server: node --env-file=/etc/meedoo/meedoo.env scripts/verify-analytics-performance.cjs /path/to/baseline
// Uses a repeatable-read transaction and rolls back every cache write. Does not contact external APIs.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { Pool } = require('pg');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const currentRoot = path.resolve(__dirname, '..');
const baselineRoot = path.resolve(process.argv[2] || '');
const json = (value) => JSON.parse(JSON.stringify(value));

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let reads = 0, fail = false;
  const db = {
    query: async (sql, args) => {
      if (/metric_snapshots/.test(sql)) { reads++; if (fail) throw new Error('injected read failure'); }
      return client.query(sql, args);
    },
    transaction: async (fn) => {
      await client.query('SAVEPOINT cache_test');
      try { const result = await fn(client); await client.query('RELEASE SAVEPOINT cache_test'); return result; }
      catch (error) { await client.query('ROLLBACK TO SAVEPOINT cache_test'); throw error; }
    },
  };
  // Both implementations read exactly the same database snapshot and use the same wall-clock cutoff.
  const NativeDate = Date, now = Date.now();
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  for (const root of new Set([currentRoot, baselineRoot])) {
    const filename = path.join(root, 'lib/db.ts');
    require.cache[filename] = { id: filename, filename, loaded: true, exports: db };
  }
  function load(root, name) {
    // Compile baseline source under the current module directory so dependencies resolve without a second install.
    const filename = path.join(currentRoot, 'lib', `${root === currentRoot ? '' : 'baseline-'}${name}.ts`);
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(ts.transpileModule(fs.readFileSync(path.join(root, 'lib', `${name}.ts`), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, filename);
    return compiled.exports;
  }
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL statement_timeout='60s'");
    const { applyFollowerHistory } = require('../lib/follower-history.ts');
    const history = [
      { publication_id: '1', captured_at: '2026-01-02', followers: 3 },
      { publication_id: '1', captured_at: '2026-01-01', followers: 0 },
      { publication_id: '1', captured_at: '2026-01-02', followers: 2 },
    ];
    const samples = ['2025-12-31', '2026-01-01', '2026-01-02', null].map(captured_at => ({ publication_id: '1', captured_at, attributed_followers: null }));
    samples.push({ publication_id: 'missing', captured_at: null, attributed_followers: null });
    applyFollowerHistory(samples, history);
    assert.deepEqual(samples.map(s => s.attributed_followers), [null, 0, 5, 5, null]);
    const precise = [{ publication_id: '1', captured_at: '2026-01-01', captured_us: '1767225600000001', attributed_followers: null }];
    applyFollowerHistory(precise, [{ publication_id: '1', captured_at: '2026-01-01', captured_us: '1767225600000002', followers: 3 }]);
    assert.equal(precise[0].attributed_followers, null, 'preserve sub-millisecond ordering');
    const oldDashboard = load(baselineRoot, 'dashboard-data').getDashboardData;
    const newDashboard = require('../lib/dashboard-data.ts').getDashboardData;
    for (const days of [1, 7, 30, 90, 365]) {
      let start = performance.now(); const before = await oldDashboard(days); const oldMs = performance.now() - start;
      start = performance.now(); const after = await newDashboard(days); const newMs = performance.now() - start;
      assert.deepEqual(json(after), json(before));
      console.log(JSON.stringify({ test: 'dashboard equal', days, oldMs: Math.round(oldMs), newMs: Math.round(newMs), videos: after.videos.length }));
    }
    const target = await client.query("SELECT id::text FROM uploads WHERE removed_at IS NULL AND review_status='approved' ORDER BY created_at DESC LIMIT 1");
    if (target.rows[0]) {
      let start = performance.now(); const before = await load(baselineRoot, 'video-detail-data').getVideoDetailData(target.rows[0].id); const oldMs = performance.now() - start;
      start = performance.now(); const after = await require('../lib/video-detail-data.ts').getVideoDetailData(target.rows[0].id); const newMs = performance.now() - start;
      assert.deepEqual(json(after), json(before));
      console.log(JSON.stringify({ test: 'video detail equal', oldMs: Math.round(oldMs), newMs: Math.round(newMs) }));
    }
    const cache = require('../lib/dashboard-cache.ts');
    await cache.invalidateDashboardCache(client);
    reads = 0;
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => cache.getCachedDashboardData(30)));
    assert(concurrent.every(data => data === concurrent[0]));
    assert.equal(reads, 3, 'ten cold requests must share one dashboard build');
    reads = 0;
    const start = performance.now();
    assert.deepEqual(json(await cache.getCachedDashboardData(30)), json(concurrent[0]));
    assert.equal(reads, 0, 'warm requests must not read metric history');
    console.log(JSON.stringify({ test: 'cache hit', ms: Math.round(performance.now() - start), historyQueries: reads }));
    await cache.refreshDashboardCache();
    reads = 0;
    for (const days of cache.dashboardRanges) await cache.getCachedDashboardData(days);
    assert.equal(reads, 0, 'sync must precompute every UI range');
    fail = true;
    await assert.rejects(cache.refreshDashboardCache(), /injected read failure/);
    assert.deepEqual(json(await cache.getCachedDashboardData(30)), json(concurrent[0]));
    fail = false;
    await cache.invalidateDashboardCache(client);
    reads = 0;
    await cache.getCachedDashboardData(30);
    assert.equal(reads, 3, 'invalidation must force a fresh build');
    console.log('PASS: numeric equality, timestamp edges, cold coalescing, all ranges, stale-on-failure, invalidation');
  } finally {
    global.Date = NativeDate;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}
main().catch(error => { console.error(error.name, error.code || error.message, error.stack?.split('\n').filter(line => line.includes('verify-analytics')).join('\n')); process.exitCode = 1; });
