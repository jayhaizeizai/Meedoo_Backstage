const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {uploadChecklistItems,uploadChecklistVersion,validUploadChecklist}=require('../lib/upload-checklist.ts');
const good={version:uploadChecklistVersion,checked:uploadChecklistItems.map(i=>i.id)};
assert.equal(uploadChecklistItems.length,16);assert.ok(validUploadChecklist(good));
const invalid=[undefined,null,true,{}, {version:'old',checked:good.checked}, {...good,checked:good.checked.slice(1)}, {...good,checked:[...good.checked.slice(1),good.checked[1]]}, {...good,checked:good.checked.map(()=>true)}, {...good,checked:[...good.checked,'extra']}];
for(const v of invalid)assert.equal(validUploadChecklist(v),false);
let authenticated=true,created=0;
const original=Module._load;
Module._load=function(id,parent,main){
 if(id.endsWith('/lib/server-auth'))return {getCurrentUser:async()=>authenticated?{openId:'test',name:'Test'}:null};
 if(id.endsWith('/lib/upload-staging'))return {acceptedVideoTypes:new Set(['video/mp4']),MAX_VIDEO_BYTES:2e9,createUploadSession:async()=>{created++;return{id:'test-stage'};},getOwnedUploadSession:async()=>{throw Error('Must not read staged upload before validation');}};
 if(['/lib/upload-post','/lib/approvals','/lib/notifications','/lib/platform-settings'].some(x=>id.endsWith(x)))return {};
 return original.call(this,id,parent,main);
};
(async()=>{try{
 const init=require('../app/api/uploads/init/route.ts').POST,publish=require('../app/api/upload-post/publish/route.ts').POST;
 const request=(checklist)=>new Request('http://localhost/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:'test.mp4',contentType:'video/mp4',size:100,checklist})});
 for(const bad of invalid)for(const route of [init,publish]){const res=await route(request(bad));assert.equal(res.status,400);assert.equal((await res.json()).code,'CHECKLIST_REQUIRED');}
 assert.equal(created,0);
 assert.equal((await init(request(good))).status,200);assert.equal(created,1);
 assert.equal((await (await publish(request(good))).json()).code,'VIDEO_TYPE_REQUIRED');
 authenticated=false;for(const route of [init,publish])assert.equal((await route(request(good))).status,401);
 console.log('PASS 16 distinct confirmations, invalid/missing/stale checklist rejected by init and publish before side effects; valid checklist accepted; auth preserved');
}finally{Module._load=original}})().catch(e=>{console.error(e);process.exitCode=1});
