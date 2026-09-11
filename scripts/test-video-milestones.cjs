const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),assert=require('node:assert/strict'),{Client}=require('pg');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
require.extensions['.ts']=(m,f)=>m._compile(compile(fs.readFileSync(f,'utf8')),f);
async function main(){
 const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 await client.query(`CREATE TEMP TABLE uploads(id uuid PRIMARY KEY,title text,original_filename text,platform_content jsonb,uploader_name text,uploader_open_id text,created_at timestamptz,removed_at timestamptz,review_status text);
 CREATE TEMP TABLE publications(id integer PRIMARY KEY,upload_id uuid,platform text,post_url text,removed_at timestamptz,status text);
 CREATE TEMP TABLE meedoo_users(open_id text,name text);
 CREATE TEMP TABLE metric_snapshots(id serial,publication_id integer,captured_at timestamptz,metrics jsonb);
 CREATE TEMP TABLE maintenance_state(key text PRIMARY KEY,value jsonb,updated_at timestamptz);`);
 const schema=fs.readFileSync('lib/db.ts','utf8').split('    CREATE TABLE IF NOT EXISTS video_milestone_state')[1].split('    CREATE INDEX IF NOT EXISTS uploads_uploader_created_idx')[0];
 await client.query(('CREATE TABLE IF NOT EXISTS video_milestone_state'+schema).replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE').replace('CREATE INDEX IF NOT EXISTS video_milestone_pending_idx','CREATE INDEX temp_video_milestone_idx'));
 const f=path.resolve('lib/video-milestones.ts'),m=new Module(f,module);m.filename=f;m.paths=Module._nodeModulePaths(path.dirname(f));const original=m.require.bind(m);
 m.require=n=>n==='./db'?{query:(q,v)=>client.query(q,v),transaction:async fn=>{await client.query('BEGIN');try{const r=await fn(client);await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}}}:n==='./auth'?{getLarkConfig:()=>({apiOrigin:'https://mock.invalid',appId:'mock',appSecret:'mock'})}:original(n);
 m._compile(compile(fs.readFileSync(f,'utf8')),f);const api=m.exports;
 for(const v of [null,{}, {reach:100000},{impressions:100000},{views:''},{views:-1},{views:NaN},{views:1.5}])assert.equal(api.milestoneViews(v),null);
 assert.equal(api.milestoneViews({views:'10000'}),10000);assert.equal(api.milestoneViews({views:0}),0);
 process.env.MEEDOO_MILESTONES_ENABLED='true';process.env.MEEDOO_MILESTONES_SEND_ENABLED='false';process.env.MEEDOO_MILESTONES_CHAT_ID='oc_mock';
 let calls=0,messages=[];global.fetch=async(url,options)=>{calls++;if(url.includes('tenant_access_token'))return{ok:true,json:async()=>({code:0,tenant_access_token:'mock'})};const body=JSON.parse(options.body);assert.equal(body.receive_id,'oc_mock');messages.push(JSON.parse(body.content).text);return{ok:true,json:async()=>({code:0,data:{message_id:'mock-'+messages.length}})};};
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',c='00000000-0000-4000-8000-000000000003';
 async function upload(id,created='2020-01-01'){await client.query(`INSERT INTO uploads VALUES($1,'raw','raw.mp4','{"youtube":{"title":"Authored title"}}','Uploader',null,$2,null,'approved')`,[id,created]);}
 async function publication(id,uploadId,platform){await client.query("INSERT INTO publications VALUES($1,$2,$3,'https://example.com/video',null,'completed')",[id,uploadId,platform]);}
 async function metric(id,metrics){await client.query("INSERT INTO metric_snapshots(publication_id,captured_at,metrics) VALUES($1,clock_timestamp(),$2)",[id,metrics]);}
 await upload(a);await publication(1,a,'youtube');await publication(2,a,'instagram');await publication(3,a,'tiktok');
 await metric(1,{views:6000});await metric(2,{views:3000});await metric(3,{reach:100000});
 let r=await api.syncVideoMilestones();assert.equal(r.baseline,true);assert.equal(calls,0);assert.equal(r.recorded,0);
 process.env.MEEDOO_MILESTONES_SEND_ENABLED='true';
 await metric(1,{views:7000});r=await api.syncVideoMilestones();assert.equal(r.sent,1);assert.ok(messages[0].includes('10,000'));assert.ok(messages[0].includes('Authored title'));assert.ok(messages[0].includes('观看数据暂不可用'));
 await api.syncVideoMilestones();assert.equal(messages.length,1);
 await metric(1,{views:1000});await api.syncVideoMilestones();await metric(1,{views:7000});await api.syncVideoMilestones();assert.equal(messages.length,1);
 // Leap over 30k and 100k: only the highest message is delivered.
 await metric(1,{views:100000});r=await api.syncVideoMilestones();assert.equal(r.recorded,2);assert.equal(r.sent,1);assert.ok(messages[1].includes('100,000'));
 assert.equal((await client.query("SELECT status FROM video_milestone_events WHERE upload_id=$1 AND threshold=30000",[a])).rows[0].status,'superseded');
 // A later-discovered old upload is baseline, never a backlog message.
 await upload(b);await publication(4,b,'youtube');await metric(4,{views:150000});await api.syncVideoMilestones();assert.equal(messages.length,2);
 // A genuinely new upload can hit its first threshold immediately; mute consumes it.
 await upload(c,new Date(Date.now()+1000));await publication(5,c,'youtube');await metric(5,{views:30000});process.env.MEEDOO_MILESTONES_SEND_ENABLED='false';const before=calls;await api.syncVideoMilestones();assert.equal(calls,before);
 process.env.MEEDOO_MILESTONES_SEND_ENABLED='true';await api.syncVideoMilestones();assert.equal(calls,before);
 await metric(5,{views:100000});await client.query("UPDATE publications SET removed_at=now() WHERE id=5");await api.syncVideoMilestones();assert.equal(calls,before);
 // A provider failure is persisted and not automatically sent again.
 await client.query("UPDATE publications SET removed_at=null WHERE id=5");global.fetch=async()=>{calls++;return{ok:false,json:async()=>({code:999})};};await api.syncVideoMilestones();assert.equal((await client.query("SELECT status FROM video_milestone_events WHERE upload_id=$1 AND threshold=100000",[c])).rows[0].status,'failed');const after=calls;await api.syncVideoMilestones();assert.equal(calls,after);
 console.log('PASS: Views-only sum, exact 10k, newest snapshots, duplicate/decrease recovery, jump to 100k, legacy baseline, mute/no backlog, removed publication, failed-send persistence. All network calls mocked; no group messages sent.');
 await client.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
