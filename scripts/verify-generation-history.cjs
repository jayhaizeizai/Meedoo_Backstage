const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{randomUUID}=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {historyPage,pagination}=require('../lib/generation-pagination.ts');
for(const value of [0,-1,1.2,'no',1000001])assert.throws(()=>historyPage(value));
assert.equal(pagination(0,1,20).totalPages,1);assert.equal(pagination(21,99,20).page,2);
console.log('PASS history pagination validation');
if(process.argv.includes('--db'))void(async()=>{
 assert.equal(process.env.LARK_APP_ID,'cli_aa1a6845a1f8de15','TEST ONLY');
 const {Pool}=require('pg'),schema='history_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);const isolated=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});global.meedooPool=isolated;global.meedooSchemaReady=undefined;
 try{
 const {query}=require('../lib/db.ts'),{generationList}=require('../lib/generation.ts'),{seedreamSchema,listSeedream}=require('../lib/seedream.ts'),{teamGenerationHistory,teamGenerationImage}=require('../lib/generation-history.ts');await seedreamSchema();
 await query("INSERT INTO meedoo_users(open_id,name,role) VALUES ('history-admin','Admin','approver'),('history-member','Member','member')");
 const asset=randomUUID();await query("INSERT INTO generation_assets(id,owner_id,path,mime,filename) VALUES($1,'history-member','/tmp/test-only-image','image/png','test.png')",[asset]);
 let oldestVideo,oldestImage;
 for(let n=0;n<125;n++){const id=randomUUID();oldestVideo=id;await query("INSERT INTO generation_tasks(id,owner_id,owner_name,request_id,requirement,input,status,created_at) VALUES($1,'history-admin','Admin',$2,'test',$3,'failed',now()-($4::int*interval '1 second'))",[id,randomUUID(),JSON.stringify({model:'minimax-h3',prompt:'test',assets:[],requestId:randomUUID()}),n]);}
 for(let n=0;n<65;n++){const id=randomUUID();oldestImage=id;await query("INSERT INTO seedream_tasks(id,owner_id,request_id,input,model,status,asset_id,created_at) VALUES($1,'history-member',$2,$3,'seedream','succeeded',$4,now()-($5::int*interval '1 second'))",[id,randomUUID(),JSON.stringify({prompt:'image',ratio:'9:16',quality:'2K'}),asset,n]);}
 assert.equal((await generationList('history-member')).tasks.length,0);
 const last=await generationList('history-admin',7,oldestVideo);assert.equal(last.tasks.length,5);assert.equal(last.pagination.total,125);assert.ok(last.ownTasks.some(t=>t.id===oldestVideo));
 const one=await generationList('history-admin',1),two=await generationList('history-admin',2);assert.ok(!one.tasks.some(a=>two.tasks.some(b=>a.id===b.id)));
 const imageLast=await listSeedream('history-member',6,oldestImage);assert.equal(imageLast.tasks.length,5);assert.ok(imageLast.recentTasks.some(t=>t.id===oldestImage));assert.equal((await listSeedream('history-admin')).tasks.length,0);
 await assert.rejects(()=>teamGenerationHistory('history-member'),/FORBIDDEN/);await assert.rejects(()=>teamGenerationImage('history-member',oldestImage),/FORBIDDEN/);
 const all=await teamGenerationHistory('history-admin');assert.equal(all.pagination.total,190);assert.ok(all.tasks.some(t=>t.kind==='video'));assert.ok(all.tasks.some(t=>t.kind==='image'));
 assert.equal((await teamGenerationHistory('history-admin',1,'video')).pagination.total,125);assert.equal((await teamGenerationHistory('history-admin',1,'image')).pagination.total,65);
 const image=await teamGenerationImage('history-admin',oldestImage);assert.equal(image.id,asset);
 await query("UPDATE generation_assets SET expires_at=now()-interval '1 second' WHERE id=$1",[asset]);await assert.rejects(()=>teamGenerationImage('history-admin',oldestImage),/NOT_FOUND/);
 const expired=await teamGenerationHistory('history-admin',1,'image');assert.ok(expired.tasks.every(t=>t.expired&&!t.mediaUrl));
 console.log('PASS isolated DB: personal approver/member scope, 125-video/65-image pagination, old selected tasks, type filters, team permissions and expired image access');
 }finally{await isolated.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
})().catch(e=>{console.error('FAILED',e.name,e.message);process.exitCode=1;});
