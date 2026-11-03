const fs=require('fs'),ts=require('typescript'),assert=require('assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {approvedVideoUtmLinks}=require('../lib/video-utm.ts');
const record={id:'e35303cd-1c1d-41b2-aa4f-ff01caf275fe',review_status:'approved',target_platforms:['threads','youtube','threads','invalid']};
for(const status of ['pending','rejected','withdrawn'])assert.deepEqual(approvedVideoUtmLinks({...record,review_status:status}),[]);
const links=approvedVideoUtmLinks(record);assert.equal(links.length,2);
for(const link of links){const u=new URL(link.url);assert.equal(u.origin,'https://meedoo.fun');assert.equal(u.pathname,'/');assert.equal(u.searchParams.get('utm_source'),link.platform);assert.equal(u.searchParams.get('utm_content'),record.id);assert.equal(u.searchParams.get('utm_medium'),'organic_social');assert.equal(u.searchParams.get('utm_campaign'),'meedoo_video');}
assert.deepEqual(approvedVideoUtmLinks({...record,title:'changed'}),links);
assert.deepEqual(approvedVideoUtmLinks({...record,id:'invalid'}),[]);
console.log('PASS approval gating, stable video/platform attribution, homepage destination, unique supported platforms');
