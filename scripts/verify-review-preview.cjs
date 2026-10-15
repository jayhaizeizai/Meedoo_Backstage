const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {parseByteRange} = require('../lib/http-byte-range.ts');
assert.deepEqual(parseByteRange('bytes=-64',100),{start:36,end:99});
assert.deepEqual(parseByteRange('bytes=90-999',100),{start:90,end:99});
assert.deepEqual(parseByteRange('bytes=90-',100),{start:90,end:99});
assert.deepEqual(parseByteRange('bytes=-200',100),{start:0,end:99});
for(const range of ['bytes=-0','bytes=-','bytes=100-','bytes=9-8','bytes=0-1,5-6','bytes=999999999999999999999-', 'words=0-5']) assert.equal(parseByteRange(range,100),null);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meedoo-review-test-'));
const original=path.join(dir,'original.mp4'), preview=path.join(dir,'preview.mp4');
fs.writeFileSync(original,Buffer.from(Array.from({length:100},(_,i)=>i)));
fs.writeFileSync(preview,Buffer.alloc(50,7));
let signedIn=true,allowed=true,ready=true;
const load=Module._load;
Module._load=function(id,parent,...rest){
 if(id.endsWith('/server-auth')) return {getCurrentUser:async()=>signedIn?{openId:'user'}:null};
 if(id.endsWith('/approvals')) return {getReviewRecord:async()=>({record:allowed?{id:'id',media_path:original,original_filename:'original.mp4'}:null})};
 if(id.endsWith('/review-preview')) return {getReviewPreview:async()=>({path:ready?preview:null})};
 if(id==='next/server') return {NextResponse:{json:(v,options)=>Response.json(v,options)}};
 return load.call(this,id,parent,...rest);
};
const route=require('../app/api/review-media/[id]/route.ts');
const context={params:Promise.resolve({id:'id'})};
async function get(range,variant='original',head=false){const req=new Request('http://test/api?variant='+variant,{headers:range?{Range:range}:{}});req.nextUrl=new URL(req.url);return route[head?'HEAD':'GET'](req,context);}
(async()=>{try{
 let r=await get('bytes=-64');assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 36-99/100');assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync(original).subarray(36));
 r=await get('bytes=40-500','preview-v1');assert.equal(r.headers.get('content-range'),'bytes 40-49/50');assert.equal((await r.arrayBuffer()).byteLength,10);
 r=await get('bytes=100-');assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */100');
 r=await get('bytes=-64','original',true);assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,0);
 ready=false;assert.equal((await get(null,'preview-v1')).status,404,'Missing pinned preview must not return original bytes');
 signedIn=false;assert.equal((await get(null)).status,401);
 signedIn=true;allowed=false;assert.equal((await get(null)).status,404);
 console.log('PASS ranges, actual byte content, preview/original isolation, HEAD, missing previews and authorization');
}finally{Module._load=load;fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
