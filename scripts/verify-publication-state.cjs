const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {providerPublicationState:state}=require('../lib/provider-publication-state.ts'),{platformResultState:ui}=require('../components/upload/upload-model.ts');
for(const status of ['processing','queued','pending','uploading','retrying']){assert.equal(state({status,success:false},'failed'),'processing');assert.equal(ui({status,success:false},'failed'),'pending');}
assert.equal(state({status:'failed',success:false,error:'rejected'}),'failed');assert.equal(state({success:false},'processing'),'processing');assert.equal(state({success:false},'completed'),'failed');assert.equal(state({status:'completed',success:true}),'completed');
console.log('PASS processing versus failure classification in server and UI');
