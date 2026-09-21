// Test-only isolated schema. Provider requests are mocked; no paid generation or notifications.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto'), { Pool } = require('pg'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const root = path.resolve(__dirname,'..');
function mock(name,exports) { const f=path.join(root,name); require.cache[f]={id:f,filename:f,loaded:true,exports}; }
let submits=0, currentUser='owner';
mock('lib/server-auth.ts',{getCurrentUser:async()=>({openId:currentUser,name:currentUser})});
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
  process.env.ARK_API_KEY='fixture';process.env.MEEDOO_MEDIA_DIR=tmp;
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
    await db.query("INSERT INTO meedoo_users(open_id,name) VALUES('owner','Owner'),('other','Other'),('admin','Admin')");
    await db.query("UPDATE meedoo_users SET role='approver' WHERE open_id='admin'");
    const deadline='2027-01-01T00:00:00Z';
    const id=randomUUID(), user={openId:'owner',name:'Owner'};
    await data.createAssignment('owner',{id,title:'Fixture',brief:'A pet video',deadline});
    assert.equal(await data.createAssignment('owner',{id,title:'Fixture',brief:'A pet video',deadline}),id);
    assert.equal((await data.assignmentDetail('other',id)).assignment.assignee_id,null);
    await assert.rejects(data.editAssignment('other',id,{action:'save',version:1}),/FORBIDDEN/);
    await data.editAssignment('owner',id,{action:'assign',version:1,assigneeId:'owner',deadline});
    await assert.rejects(data.assignmentDetail('other',id),/NOT_FOUND/);
    assert.equal((await data.assignmentDetail('admin',id)).assignment.assignee_id,'owner');
    await assert.rejects(data.editAssignment('other',id,{action:'save',version:1}),/NOT_FOUND/);
    await assert.rejects(data.editAssignment('owner',id,{action:'save',version:0}),/REQUEST_CONFLICT/);
    const summaryId=randomUUID();await planner.queueAssignmentPlan('owner',id,{requestId:summaryId,version:2,kind:'summary'});
    await planner.runAssignmentPlans();await planner.runAssignmentPlans();assert.equal(aiCalls,1);
    await data.editAssignment('owner',id,{action:'apply_plan',version:2,planId:summaryId});
    let detail=await data.assignmentDetail('owner',id);assert.equal(detail.assignment.summary,'Fixture summary');
    await assert.rejects(data.editAssignment('owner',id,{action:'apply_plan',version:2,planId:summaryId}),/REQUEST_CONFLICT/);
    const assetId=randomUUID(), assetPath=path.join(tmp,'board.png');await fsp.writeFile(assetPath,Buffer.from([137,80,78,71]));
    await db.query("INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,'owner',$2,'image/png','board.png')",[assetId,assetPath]);
    await data.editAssignment('owner',id,{action:'save',version:3,title:'Fixture',brief:'A pet video',summary:'Summary',storyboardPrompt:'Board',storyboardAssetId:assetId});
    const planId=randomUUID();await planner.queueAssignmentPlan('owner',id,{requestId:planId,version:4,kind:'shots'});await planner.runAssignmentPlans();assert.equal(aiCalls,2);
    await data.editAssignment('owner',id,{action:'apply_plan',version:4,planId});detail=await data.assignmentDetail('owner',id);assert.equal(detail.shots.length,1);
    const shotId=detail.shots[0].id, requestId=randomUUID();
    const input={requestId,model:'seedance-2.0-fast',mode:'reference',prompt:'Test camera action',duration:6,resolution:'720p',ratio:'9:16',assets:[]};
    const command={action:'video',shotId,requestId,input};
    await assert.rejects(data.generateForAssignment({openId:'other',name:'Other'},id,command),/NOT_FOUND/);
    const [a,b]=await Promise.all([data.generateForAssignment(user,id,command),data.generateForAssignment(user,id,command)]);assert.equal(a,b);assert.equal(submits,1);
    const nextId=randomUUID();await assert.rejects(data.generateForAssignment(user,id,{...command,requestId:nextId,input:{...input,requestId:nextId}}),/GENERATION_PENDING/);
    detail=await data.assignmentDetail('owner',id);assert.equal(detail.runs[0].video_id,a);assert.equal(detail.runs[0].status,'queued');
    const laterPlan=randomUUID();await planner.queueAssignmentPlan('owner',id,{requestId:laterPlan,version:5,kind:'shots'});await planner.runAssignmentPlans();
    await assert.rejects(data.editAssignment('owner',id,{action:'apply_plan',version:5,planId:laterPlan}),/SHOTS_HAVE_GENERATIONS/);
    const foreignAsset=randomUUID();await db.query("INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,'other',$2,'image/png','foreign.png')",[foreignAsset,assetPath]);
    await assert.rejects(data.editAssignment('owner',id,{action:'save_shot',version:5,shotId,title:'Shot',prompt:'Prompt',duration:6,referenceAssetId:foreignAsset}),/INVALID_ASSETS/);
    // Seedream requests reuse the same durable provider queue and remain linked by request id.
    const imageId=randomUUID(), imageInput={requestId:imageId,prompt:'Board',ratio:'16:9',quality:'2K',baseAssetId:assetId};
    const imageTask=await data.generateForAssignment(user,id,{action:'storyboard',requestId:imageId,input:imageInput});
    assert.equal(await data.generateForAssignment(user,id,{action:'storyboard',requestId:imageId,input:imageInput}),imageTask);
    detail=await data.assignmentDetail('owner',id);assert(detail.runs.some(r=>r.image_id===imageTask));
    // Reassignment changes task visibility while preserving attached media and generation history.
    await db.query("UPDATE seedream_tasks SET status='succeeded',asset_id=$2 WHERE id=$1",[imageTask,assetId]);
    await data.editAssignment('owner',id,{action:'assign',version:5,assigneeId:'other',deadline});
    await assert.rejects(data.assignmentDetail('owner',id),/NOT_FOUND/);
    detail=await data.assignmentDetail('other',id);assert.equal(detail.runs.length,2);assert(detail.availableAssets.includes(assetId));
    assert.equal((await data.assignmentList('owner')).total,0);assert.equal((await data.assignmentList('admin')).total,1);
    const newImageId=randomUUID();
    await data.generateForAssignment({openId:'other',name:'Other'},id,{action:'storyboard',requestId:newImageId,input:{...imageInput,requestId:newImageId}});
    const copied=(await db.query("SELECT input FROM seedream_tasks WHERE owner_id='other' AND request_id=$1",[newImageId])).rows[0].input.baseAssetId;
    assert.notEqual(copied,assetId);assert.equal((await db.query('SELECT owner_id FROM generation_assets WHERE id=$1',[copied])).rows[0].owner_id,'other');
    const {NextRequest}=require('next/server');
    const mediaRoute=require('../app/api/assignments/[id]/media/[asset]/route.ts');
    const mediaContext={params:Promise.resolve({id,asset:assetId})};
    currentUser='owner';assert.equal((await mediaRoute.GET(new NextRequest('http://test/api/media'),mediaContext)).status,404);
    currentUser='other';const imageResponse=await mediaRoute.GET(new NextRequest('http://test/api/media'),mediaContext);assert.equal(imageResponse.status,200);await imageResponse.arrayBuffer();
    assert.equal((await mediaRoute.GET(new NextRequest('http://test/api/media'),{params:Promise.resolve({id,asset:foreignAsset})})).status,404);
    const videoFile=path.join(tmp,'generation','fixture.mp4');await fsp.writeFile(videoFile,Buffer.from('fixture-video'));
    await db.query("UPDATE generation_tasks SET status='succeeded',media_path=$2,media_expires_at=now()+interval '1 day' WHERE id=$1",[a,videoFile]);
    const videoResponse=await mediaRoute.GET(new NextRequest('http://test/api/media?type=video',{headers:{range:'bytes=0-6'}}),{params:Promise.resolve({id,asset:a})});assert.equal(videoResponse.status,206);assert.equal(Buffer.from(await videoResponse.arrayBuffer()).toString(),'fixture');
    const download=require('../app/api/assignments/[id]/download/route.ts');
    const check=await download.GET(new NextRequest('http://test/download?check=1'),{params:Promise.resolve({id})});assert.equal(check.status,200);assert.equal((await check.json()).count,1);
    currentUser='owner';assert.equal((await download.GET(new NextRequest('http://test/download?check=1'),{params:Promise.resolve({id})})).status,404);
    const studio=require('../lib/assignments/shot-studio.ts');
    await assert.rejects(studio.shotAccess('owner',id,shotId),/NOT_FOUND/);
    const shotTwo=randomUUID();await db.query("INSERT INTO assignment_shots(id,assignment_id,position,title,prompt,duration) VALUES($1,$2,2,'Second','Second shot',6)",[shotTwo,id]);
    await assert.rejects(studio.shotVideo(id,shotTwo,a),/NOT_FOUND/);
    assert.equal((await studio.shotHistory('other',id,shotId,1,false)).tasks.length,1);
    assert.equal((await studio.shotHistory('other',id,shotTwo,1,false)).tasks.length,0);
    const scopedImage=randomUUID();
    await data.generateForAssignment({openId:'other',name:'Other'},id,{action:'storyboard',shotId,requestId:scopedImage,input:{...imageInput,requestId:scopedImage}});
    assert.equal((await studio.shotHistory('other',id,shotId,1,true)).tasks.length,1);
    assert.equal((await studio.shotHistory('other',id,shotTwo,1,true)).tasks.length,0);
    const adopted=await studio.shotAssets('other',id,[assetId]);assert.equal(adopted[0].sourceId,assetId);assert.notEqual(adopted[0].id,assetId);
    const scopedRoute=require('../app/api/assignments/[id]/shots/[shot]/generation/[[...operation]]/route.ts');
    currentUser='other';
    const scopedContext={params:Promise.resolve({id,shot:shotId,operation:[]})};
    const scopedList=await scopedRoute.GET(new NextRequest('http://test/studio'),scopedContext);assert.equal(scopedList.status,200);assert.equal((await scopedList.json()).tasks.length,1);
    const wrongShot=await scopedRoute.GET(new NextRequest('http://test/studio'),{params:Promise.resolve({id,shot:shotTwo,operation:[a,'media']})});assert.equal(wrongShot.status,404);
    await db.query("UPDATE generation_tasks SET status='failed' WHERE id=$1",[a]);
    const restored=await scopedRoute.POST(new NextRequest('http://test/studio',{method:'POST'}),{params:Promise.resolve({id,shot:shotId,operation:[a,'restore']})});assert.equal(restored.status,200);assert.equal((await restored.json()).input.prompt,input.prompt);
    currentUser='owner';assert.equal((await scopedRoute.GET(new NextRequest('http://test/studio'),scopedContext)).status,404);
    await data.editAssignment('admin',id,{action:'assign',version:6,assigneeId:null,deadline});
    assert.equal((await data.assignmentList('owner')).total,1);
    const claims=await Promise.allSettled(['owner','other'].map(who=>data.editAssignment(who,id,{action:'assign',version:7,assigneeId:who,deadline})));
    assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
    // Test the ZIP with the independent standard-library reader, including CRC validation.
    const {zipStream}=require('../lib/assignments/zip.ts');
    const stream=await zipStream([{name:'shot-01.mp4',bytes:Buffer.from('fixture-video')},{name:'manifest.json',bytes:Buffer.from('{}')}],new AbortController().signal);
    const archive=Buffer.from(await new Response(stream).arrayBuffer());const filename=path.join(tmp,'test.zip');await fsp.writeFile(filename,archive);
    execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("shot-01.mp4")==b"fixture-video"; assert len(z.namelist())==2',filename]);
    console.log('PASS assignment visibility, deadline, concurrent claim, reassignment media, ownership, optimistic edits, vision planning, draft apply, generated-shot protection, video idempotency, storyboard linking and ZIP CRC');
  } finally {
    await global.meedooPool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
    if(!tmp.startsWith(path.join(os.tmpdir(),'meedoo-assignment-test-')))throw Error('UNSAFE_CLEANUP');await fsp.rm(tmp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e.name,e.code||e.message);process.exitCode=1;});
