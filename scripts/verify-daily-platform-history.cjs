const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {dailyPlatformHistory}=require('../lib/daily-platform-history.ts');
const sample=(publicationId,platform,capturedAt,likes,views=null)=>({publicationId,platform,capturedAt,metrics:{likes,views}});
const rows=dailyPlatformHistory([
 sample('a','tiktok','2026-09-20T15:59:59Z',2),
 sample('a','tiktok','2026-09-20T16:00:00Z',3),
 sample('a','tiktok','2026-09-21T14:00:00Z',8,100),
 sample('a','tiktok','2026-09-21T13:00:00Z',5,80),
 sample('b','tiktok','2026-09-21T14:00:00Z',4,50),
 sample('c','youtube','2026-09-21T14:00:00Z',0,0),
 sample('a','tiktok','2026-09-23T14:00:00Z',999),
 sample('a','tiktok','invalid',999),
 sample('a','tiktok','2026-07-01T14:00:00Z',999),
],['tiktok','youtube','instagram'],['likes','views'],new Date('2026-09-22T02:00:00Z'));
assert.equal(rows.length,30);assert.equal(rows[0].day,'2026-08-24');assert.equal(rows.at(-1).day,'2026-09-22');
assert.equal(rows.find(r=>r.day==='2026-09-20').platforms[0].metrics.likes,2);
const day=rows.find(r=>r.day==='2026-09-21');assert.equal(day.platforms[0].metrics.likes,12);assert.equal(day.platforms[0].metrics.views,150);assert.equal(day.platforms[1].metrics.likes,0);assert.equal(day.platforms[2].metrics.likes,null);
assert.equal(rows.at(-1).platforms[0].metrics.likes,null);assert.equal(rows[0].platforms[0].metrics.likes,null);
assert.equal(dailyPlatformHistory([],['tiktok'],['likes'],new Date('2026-09-22T02:00:00Z')).every(r=>r.platforms[0].metrics.likes===null),true);
console.log('PASS Singapore day boundary, latest per publication, platform aggregation, zero vs missing, no carry-forward and invalid/future exclusion');
