const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'meedoo-switch-'));
process.env.MEEDOO_FEATURES_FILE=path.join(tmp,'features.json');
process.env.LARK_AUTH_REQUIRED='false';
try{
 const {assignmentsEnabled}=require('../lib/feature-settings.ts'),{proxy}=require('../proxy.ts'),{NextRequest}=require('next/server');
 assert.equal(assignmentsEnabled(),false);
 for(const value of [false,true]){
  fs.writeFileSync(process.env.MEEDOO_FEATURES_FILE,JSON.stringify({assignments:value}));
  assert.equal(assignmentsEnabled(),value);
  for(const url of ['/assignments','/assignments/example','/api/assignments','/api/assignments/example/shots/example/generation'])assert.equal(proxy(new NextRequest('http://test'+url)).status,value?200:404);
  assert.equal(proxy(new NextRequest('http://test/generate')).status,200);
 }
 fs.writeFileSync(process.env.MEEDOO_FEATURES_FILE,'invalid');assert.equal(assignmentsEnabled(),false);
 console.log('PASS runtime switch, missing/invalid fail closed, assignment page/API blocking and existing generation unaffected');
}finally{fs.rmSync(process.env.MEEDOO_FEATURES_FILE,{force:true});fs.rmdirSync(tmp);}
