// Test-only isolated schema. Provider requests are mocked; no paid generation or notifications.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto'), { Pool } = require('pg'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const root = path.resolve(__dirname,'..');
function mock(name,exports) { const f=path.join(root,name); require.cache[f]={id:f,filename:f,loaded:true,exports}; }
let submits=0;
mock('lib/generation-provider.ts',{
  providerConfigured:()=>true,
  submitGeneration:async()=>{submits++;return 'fixture-'+randomUUID();},
  ProviderError:class extends Error {},safeProviderDiagnostic:()=>({}),
});
(async()=>{
  assert.equal(process.env.LARK_APP_ID,'cli_aa1a6845a1f8de15');
  const schema='assignments_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
  global.meedooPool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'meedoo-assignment-test-'));
  process.env.ARK_API_KEY='fixture';
  let aiCalls=0;
  global.fetch=async(url,init)=>{
    assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    const body=JSON.parse(init.body); assert.equal(body.response_format.type,'json_object');aiCalls++;
    const input=JSON.parse(body.messages[1].content[0].text);
    if(input.storyboardAssetId) assert(body.messages[1].content.some(c=>c.type==='image_url'&&c.image_url.url.startsWith('data:image/png;base64,')));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Fixture summary',storyboardPrompt:'A three-panel storyboard',shots:input.task==='shots'?[{title:'Shot one',prompt:'One continuous camera movement',duration:6}]:[]})}}],usage:{total_tokens:12}}),{status:200});
  };
  try {
    const db=require('../lib/db.ts'), data=require('../lib/assignments/data.ts'), planner=require('../lib/assignments/planner.ts');
    await db.query("INSERT INTO meedoo_users(open_id,name) VALUES('owner','Owner'),('other','Other')");
    const id=randomUUID(), user={openId:'owner',name:'Owner'};
    await data.createAssignment('owner',{id,title:'Fixture',brief:'A pet video'});
    assert.equal(await data.createAssignment('owner',{id,title:'Fixture',brief:'A pet video'}),id);
    await assert.rejects(data.assignmentDetail('other',id),/NOT_FOUND/);
    await assert.rejects(data.editAssignment('other',id,{action:'save',version:1}),/NOT_FOUND/);
    await assert.rejects(data.editAssignment('owner',id,{action:'save',version:0}),/REQUEST_CONFLICT/);
    const summaryId=randomUUID();await planner.queueAssignmentPlan('owner',id,{requestId:summaryId,version:1,kind:'summary'});
    await planner.runAssignmentPlans();await planner.runAssignmentPlans();assert.equal(aiCalls,1);
    await data.editAssignment('owner',id,{action:'apply_plan',version:1,planId:summaryId});
    let detail=await data.assignmentDetail('owner',id);assert.equal(detail.assignment.summary,'Fixture summary');
    await assert.rejects(data.editAssignment('owner',id,{action:'apply_plan',version:2,planId:summaryId}),/REQUEST_CONFLICT/);
    const assetId=randomUUID(), assetPath=path.join(tmp,'board.png');await fsp.writeFile(assetPath,Buffer.from([137,80,78,71]));
    await db.query("INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,'owner',$2,'image/png','board.png')",[assetId,assetPath]);
    await data.editAssignment('owner',id,{action:'save',version:2,title:'Fixture',brief:'A pet video',summary:'Summary',storyboardPrompt:'Board',storyboardAssetId:assetId});
    const planId=randomUUID();await planner.queueAssignmentPlan('owner',id,{requestId:planId,version:3,kind:'shots'});await planner.runAssignmentPlans();assert.equal(aiCalls,2);
    await data.editAssignment('owner',id,{action:'apply_plan',version:3,planId});detail=await data.assignmentDetail('owner',id);assert.equal(detail.shots.length,1);
    const shotId=detail.shots[0].id, requestId=randomUUID();
    const input={requestId,model:'seedance-2.0-fast',mode:'reference',prompt:'Test camera action',duration:6,resolution:'720p',ratio:'9:16',assets:[]};
    const command={action:'video',shotId,requestId,input};
    await assert.rejects(data.generateForAssignment({openId:'other',name:'Other'},id,command),/NOT_FOUND/);
    const [a,b]=await Promise.all([data.generateForAssignment(user,id,command),data.generateForAssignment(user,id,command)]);assert.equal(a,b);assert.equal(submits,1);
    const nextId=randomUUID();await assert.rejects(data.generateForAssignment(user,id,{...command,requestId:nextId,input:{...input,requestId:nextId}}),/GENERATION_PENDING/);
    detail=await data.assignmentDetail('owner',id);assert.equal(detail.runs[0].video_id,a);assert.equal(detail.runs[0].status,'queued');
    const laterPlan=randomUUID();await planner.queueAssignmentPlan('owner',id,{requestId:laterPlan,version:4,kind:'shots'});await planner.runAssignmentPlans();
    await assert.rejects(data.editAssignment('owner',id,{action:'apply_plan',version:4,planId:laterPlan}),/SHOTS_HAVE_GENERATIONS/);
    const foreignAsset=randomUUID();await db.query("INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,'other',$2,'image/png','foreign.png')",[foreignAsset,assetPath]);
    await assert.rejects(data.editAssignment('owner',id,{action:'save_shot',version:4,shotId,title:'Shot',prompt:'Prompt',duration:6,referenceAssetId:foreignAsset}),/INVALID_ASSETS/);
    // Seedream requests reuse the same durable provider queue and remain linked by request id.
    const imageId=randomUUID(), imageInput={requestId:imageId,prompt:'Board',ratio:'16:9',quality:'2K',baseAssetId:assetId};
    const imageTask=await data.generateForAssignment(user,id,{action:'storyboard',requestId:imageId,input:imageInput});
    assert.equal(await data.generateForAssignment(user,id,{action:'storyboard',requestId:imageId,input:imageInput}),imageTask);
    detail=await data.assignmentDetail('owner',id);assert(detail.runs.some(r=>r.image_id===imageTask));
    // Test the ZIP with the independent standard-library reader, including CRC validation.
    const {zipStream}=require('../lib/assignments/zip.ts');
    const stream=await zipStream([{name:'shot-01.mp4',bytes:Buffer.from('fixture-video')},{name:'manifest.json',bytes:Buffer.from('{}')}],new AbortController().signal);
    const archive=Buffer.from(await new Response(stream).arrayBuffer());const filename=path.join(tmp,'test.zip');await fsp.writeFile(filename,archive);
    execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("shot-01.mp4")==b"fixture-video"; assert len(z.namelist())==2',filename]);
    console.log('PASS assignment ownership, optimistic edits, vision planning, draft apply, generated-shot protection, video idempotency, storyboard linking and ZIP CRC');
  } finally {
    await global.meedooPool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
    if(!tmp.startsWith(path.join(os.tmpdir(),'meedoo-assignment-test-')))throw Error('UNSAFE_CLEANUP');await fsp.rm(tmp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e.name,e.code||e.message);process.exitCode=1;});
