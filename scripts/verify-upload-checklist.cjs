const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {uploadChecklistItems,uploadChecklistVersion,validUploadChecklist}=require('../lib/upload-checklist.ts');
const good={version:uploadChecklistVersion,checked:uploadChecklistItems.map(i=>i.id)};
assert.equal(uploadChecklistItems.length,17);assert.ok(validUploadChecklist(good));
const invalid=[{...good,checked:good.checked.filter(id=>id!=='music-beat')},undefined,null,true,{}, {version:'old',checked:good.checked}, {...good,checked:good.checked.slice(1)}, {...good,checked:[...good.checked.slice(1),good.checked[1]]}, {...good,checked:good.checked.map(()=>true)}, {...good,checked:[...good.checked,'extra']}];
for(const v of invalid)assert.equal(validUploadChecklist(v),false);
const {prepareVideoUpload}=require('../components/upload/upload-transport.ts');
const originalFetch=global.fetch;
(async()=>{try{
 global.fetch=async()=>{throw Error('Incomplete checklist must not start any network request');};
 for(const bad of invalid)await assert.rejects(prepareVideoUpload({},null,()=>{},()=>{},(_,en)=>en,bad),/Complete the pre-upload checklist/);
 console.log('PASS frontend: 17 unique confirmations required; missing/partial/duplicate/stale checklist starts no upload request');
}finally{global.fetch=originalFetch}})().catch(e=>{console.error(e);process.exitCode=1});
