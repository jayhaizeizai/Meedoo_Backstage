// TEST ONLY: isolated schema and mocked provider; never publishes to a social account.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const root=path.resolve(__dirname,'..');
const mock=(name,exports)=>{const f=path.join(root,name);require.cache[f]={id:f,filename:f,loaded:true,exports};};
const {supportedPlatforms,requiredPlatforms,socialTextLength}=require('../lib/social-platforms.ts');
const forms=[],urls=[];let pinned='page-a',duration=25;
const json=data=>new Response(JSON.stringify(data));
mock('lib/upload-post.ts',{
  supportedPlatforms,requiredPlatforms,getUploadPostConfig:()=>({profile:'fixture',facebookPageId:'page-a'}),
  parseProviderResponse:r=>r.json(),providerMessage:()=> 'fixture failure',
  uploadPostFetch:async(url,init={})=>{
    urls.push(url);
    if(init.method==='POST'){forms.push(init.body);return json({success:true,request_id:init.body.get('request_id'),status:'queued'});}
    if(url.includes('/users/facebook-page'))return json({success:true,pages:[{id:'page-a'}],selected_page_id:pinned});
    if(url.startsWith('/api/analytics/'))return json(Object.fromEntries(supportedPlatforms.map(p=>[p,{followers:123}])));
    const p=new URL('https://fixture'+url).searchParams.get('platform');
    return json({platforms:{[p]:{post_metrics:p==='facebook'?{reach:500,views:900,likes:5,shares:7}:p==='x'?{impressions:800,views:200,likes:6,retweets:8}:{views:100,likes:1}}}});
  },
});
mock('lib/server-auth.ts',{getCurrentUser:async()=>({openId:'fixture-user',name:'Fixture'})});
mock('lib/media-url.ts',{createMediaUrl:()=> 'https://fixture.invalid/video'});
mock('lib/video-probe.ts',{probeVideo:async()=>({width:1080,height:1920,duration,codec:'h264'}),isVerticalNineSixteen:()=>true});
const contentLib=require('../lib/platform-content.ts');
assert.deepEqual(requiredPlatforms,supportedPlatforms);
const legacy=Object.fromEntries(["tiktok","instagram","youtube"].map(p=>[p,{title:p+' title',caption:p+' caption'}]));
assert.ok(contentLib.parsePlatformContent(legacy));
assert.equal(contentLib.contentForPlatform(legacy,'instagram','fallback','fallback').title,'instagram title');
const content={...legacy,facebook:{title:'Facebook title',caption:'Facebook caption'},x:{title:'X title',caption:'X caption'}};
assert.equal(contentLib.validatePlatformContent(content,supportedPlatforms),null);
assert.equal(contentLib.validatePlatformContent(legacy,supportedPlatforms),'FACEBOOK_CONTENT_REQUIRED');
assert.equal(socialTextLength('x','中文A'),5);
assert.equal(contentLib.validatePlatformContent({...content,x:{title:'x',caption:'a'.repeat(278)}},['x']),'X_SOCIAL_TEXT_TOO_LONG');
const form=new FormData();require('../lib/social-publish-fields.ts').appendSocialPublishFields(form,['facebook','x'],content,'fallback','fallback','page-a');
assert.equal(form.get('facebook_page_id'),'page-a');assert.equal(form.get('facebook_media_type'),'REELS');assert.equal(form.get('facebook_description'),'Facebook caption');assert.equal(form.get('x_title'),'X title\n\nX caption');
assert.throws(()=>require('../lib/social-publish-fields.ts').appendSocialPublishFields(new FormData(),['facebook'],content,'','',''),/FACEBOOK_PAGE_REQUIRED/);
console.log('PASS legacy three-platform content, optional validation, X limits, platform-specific form fields');

async function main(){
  assert.equal(process.env.LARK_APP_ID,'cli_aa1a6845a1f8de15');
  global.fetch=async()=>{throw new Error('UNEXPECTED_EXTERNAL_REQUEST');};
  const {Pool}=require('pg'),schema='facebook_x_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
  global.meedooPool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  const db=require('../lib/db.ts');
  try{
    await db.ensureSchema();
    await db.query("INSERT INTO meedoo_users(open_id,name,role) VALUES('fixture-user','Fixture','approver')");
    const id=randomUUID();
    await db.query(`INSERT INTO upload_sessions(id,uploader_open_id,uploader_name,original_filename,content_type,expected_size,chunk_size,total_chunks,media_path,status,expires_at)
      VALUES($1,'fixture-user','Fixture','fixture.mp4','video/mp4',1,1,1,'/fixture/video','ready',now()+interval '1 day')`,[id]);
    const session=(await db.query('SELECT * FROM upload_sessions WHERE id=$1',[id])).rows[0],user={openId:'fixture-user',name:'Fixture'};
    const approvals=require('../lib/approvals.ts');
    duration=100;
    await assert.rejects(()=>approvals.submitForReview({session,user,platformContent:content,platforms:supportedPlatforms}),/FACEBOOK_REELS_VIDEO_REQUIREMENTS/);
    duration=25;
    await approvals.submitForReview({session,user,platformContent:content,platforms:supportedPlatforms});
    assert.equal((await db.query('SELECT facebook_page_id FROM uploads WHERE id=$1',[id])).rows[0].facebook_page_id,'page-a');
    pinned='page-b';
    await assert.rejects(()=>approvals.decideReview(id,user,'approved','',content),/FACEBOOK_PINNED_PAGE_CHANGED/);
    assert.equal(forms.length,0);
    pinned='page-a';
    await assert.rejects(()=>approvals.decideReview(id,user,'approved','',legacy),/FACEBOOK_CONTENT_REQUIRED/);
    await approvals.decideReview(id,user,'approved','',content);
    assert.equal((await db.query('SELECT count(*) n FROM publications WHERE upload_id=$1',[id])).rows[0].n,'5');
    await require('../lib/publish-approved.ts').publishApprovedUpload(id);
    assert.deepEqual(forms[0].getAll('platform[]'),supportedPlatforms);
    assert.equal(forms[0].get('facebook_page_id'),'page-a');assert.equal(forms[0].get('x_title'),'X title\n\nX caption');
    await db.query("UPDATE publications SET status='failed' WHERE upload_id=$1 AND platform='facebook'",[id]);
    const retry=require('../app/api/upload-post/retry/route.ts');
    const response=await retry.POST(new Request('https://fixture/retry',{method:'POST',body:JSON.stringify({uploadId:id,platform:'facebook'})}));
    assert.equal(response.status,200);assert.deepEqual(forms[1].getAll('platform[]'),['facebook']);assert.equal(forms[1].get('facebook_page_id'),'page-a');
    await db.query("UPDATE publications SET status='completed',platform_post_id='fixture-'||platform WHERE upload_id=$1",[id]);
    assert.equal(await require('../lib/upload-post-sync.ts').syncAnalytics(),5);
    const profile=require('../lib/profile-analytics.ts');await profile.syncProfileAnalytics();
    assert.ok(urls.some(url=>url.startsWith('/api/analytics/')&&url.includes('page_id=page-a')));
    const dashboard=await require('../lib/dashboard-data.ts').getDashboardData(30);
    assert.equal(dashboard.team.byPlatform.facebook.metrics.views,500);
    assert.equal(dashboard.team.byPlatform.x.metrics.views,800);
    assert.equal(dashboard.team.byPlatform.x.metrics.shares,8);
    assert.equal(dashboard.team.byPlatform.x.metrics.followers,null);
    assert.equal(dashboard.team.byPlatform.facebook.metrics.retention,null);
    assert.equal(dashboard.team.mix.length,5);
    const detail=await require('../lib/video-detail-data.ts').getVideoDetailData(id);
    assert.equal(detail.video.metrics.facebook.views,500);assert.equal(detail.video.metrics.x.views,800);
    const weekly=await require('../lib/weekly-report-data.ts').getWeeklyReportData();
    assert.ok(JSON.stringify(weekly).includes('facebook'));assert.ok(JSON.stringify(weekly).includes('"x"'));
    console.log('PASS isolated DB: five-platform review, destination changes rejected, publication/retry fields, sync, metrics, weekly report');
    console.log('No external posts, messages, or account changes made');
  }finally{await global.meedooPool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
if(process.argv.includes('--db'))main().catch(e=>{console.error(e.name,e.code||e.message);process.exitCode=1;});
