// Local synthetic media only. No provider calls or publishing.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const root=path.resolve(__dirname,'..');
function mock(name,exports){const f=path.join(root,name);require.cache[f]={id:f,filename:f,loaded:true,exports};}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meedoo-media-check-'));
const file=path.join(dir,'video.mp4');fs.writeFileSync(file,Buffer.alloc(2048,7));
const session={media_path:file,status:'publishing',content_type:'video/mp4'};
let upload={id:'fixture',review_status:'approved',removed_at:null,file_deleted_at:null};
mock('lib/upload-staging.ts',{getReadyUploadSession:async()=>session});
mock('lib/db.ts',{query:async()=>({rows:upload?[upload]:[]})});
mock('lib/auth.ts',{getLarkConfig:()=>({appUrl:'https://fixture.invalid'})});
process.env.MEDIA_URL_SECRET='synthetic-media-test-secret-000000000000';
const {createMediaUrl}=require('../lib/media-url.ts');
const route=require('../app/api/media/[id]/[filename]/route.ts');
const ctx={params:Promise.resolve({id:'fixture',filename:'video.mp4'})};
const request=(range)=>({nextUrl:new URL(createMediaUrl('fixture','video.mp4')),headers:new Headers(range?{range}:{})});
(async()=>{try{
  for(const status of ['publishing','consumed','submitted']){
    session.status=status;
    assert.equal((await route.HEAD(request(),ctx)).status,200,`approved ${status} media must remain accessible`);
  }
  const partial=await route.GET(request('bytes=0-15'),ctx);
  assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,16);
  for(const review of ['pending','rejected']){upload.review_status=review;assert.equal((await route.HEAD(request(),ctx)).status,404);}
  upload.review_status='approved';upload.removed_at='now';assert.equal((await route.HEAD(request(),ctx)).status,404);
  upload.removed_at=null;upload.file_deleted_at='now';assert.equal((await route.HEAD(request(),ctx)).status,404);
  upload=null;session.status='ready';assert.equal((await route.HEAD(request(),ctx)).status,200);
  session.status='submitted';assert.equal((await route.HEAD(request(),ctx)).status,404);
  const bad=request();bad.nextUrl.searchParams.set('signature','invalid');assert.equal((await route.HEAD(bad,ctx)).status,403);
  console.log('PASS approved media lifecycle, retry readability, range, unapproved/removed/deleted denial and signatures');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1});
