const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { Pool } = require('pg'), ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const root = path.resolve(__dirname,'..');
function mock(name,exports) { const f=path.join(root,name);require.cache[f]={id:f,filename:f,loaded:true,exports}; }
mock('lib/video-probe.ts',{probeVideo:async()=>({width:720,height:1280,duration:6,codec:'h264'}),isVerticalNineSixteen:()=>true});
mock('lib/upload-post.ts',{getUploadPostConfig:()=>({profile:'fixture'}),supportedPlatforms:['youtube']});
mock('lib/server-auth.ts',{getCurrentUser:async()=>({openId:'fixture',name:'Fixture'})});
mock('lib/notifications.ts',{notifyApprovers:async()=>{throw new Error('UNEXPECTED_NOTIFICATION');}});
(async()=>{
  assert.equal(process.env.LARK_APP_ID,'cli_aa1a6845a1f8de15');
  global.fetch=async()=>{throw new Error('UNEXPECTED_NETWORK');};
  const schema='followers_types_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString:process.env.DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  global.meedooPool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    const db=require('../lib/db.ts');
    await db.query("INSERT INTO meedoo_users(open_id,name) VALUES('fixture','Fixture')");
    const {POST}=require('../app/api/upload-post/publish/route.ts');
    for(const videoType of [undefined,'invalid',null]) {
      const response=await POST(new Request('http://fixture/api/upload-post/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoType})}));
      assert.equal(response.status,400);assert.equal((await response.json()).code,'VIDEO_TYPE_REQUIRED');
    }
    const {submitForReview}=require('../lib/approvals.ts');
    for(const videoType of ['repost','saves','website_visit']) {
      const id=randomUUID();
      await db.query("INSERT INTO upload_sessions(id,uploader_open_id,uploader_name,original_filename,content_type,expected_size,chunk_size,total_chunks,media_path,status,expires_at) VALUES($1,'fixture','Fixture','video.mp4','video/mp4',100,100,1,'/fixture','ready',now()+interval '1 day')",[id]);
      const session=(await db.query('SELECT * FROM upload_sessions WHERE id=$1',[id])).rows[0];
      await submitForReview({videoType,session,user:{openId:'fixture',name:'Fixture'},platforms:['youtube'],platformContent:{youtube:{title:'Fixture',caption:'Fixture'}}});
      assert.equal((await db.query('SELECT video_type FROM uploads WHERE id=$1',[id])).rows[0].video_type,videoType);
    }
    const day=(await db.query("SELECT ((now() AT TIME ZONE 'Asia/Singapore')::date-1)::text day")).rows[0].day;
    for(const [platform,time,followers] of [['tiktok','01:00:00',10],['tiktok','23:00:00',12],['youtube','22:00:00',0]])
      await db.query('INSERT INTO profile_metric_snapshots(platform,captured_at,followers) VALUES($1,$2,$3)',[platform,`${day}T${time}+08:00`,followers]);
    const {getDashboardData}=require('../lib/dashboard-data.ts');
    for(const days of [1,7,30,90,365]) {
      const history=(await getDashboardData(days)).team.accountFollowerHistory;
      assert.equal(history.length,days);
      assert(history.at(-1).platforms.every(row=>row.followers===null));
      if(days>1){
        const yesterday=history.at(-2);assert.equal(yesterday.day,day);
        assert.equal(yesterday.platforms.find(row=>row.platform==='tiktok').followers,12);
        assert.equal(yesterday.platforms.find(row=>row.platform==='youtube').followers,0);
        assert.equal(yesterday.platforms.find(row=>row.platform==='x').followers,null);
      }
    }
    console.log('PASS: required video type validation, all three types persist; daily history range, Singapore day, latest snapshot, zero and missing values');
  } finally { await global.meedooPool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end(); }
})().catch(e=>{console.error(e.name,e.code||e.message);process.exitCode=1;});
