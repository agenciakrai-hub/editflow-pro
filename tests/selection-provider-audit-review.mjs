import assert from 'node:assert/strict';
import {build} from 'esbuild';
const r=await build({entryPoints:['base44/functions/rawAiSmartSelect/entry.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'fixture'}));
 b.onResolve({filter:/^base44:runtime$/},()=>({path:'runtime',namespace:'fixture'}));
 b.onResolve({filter:/rawAiStudioEngine\.ts$/},()=>({path:'upload',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='sdk'?'export const createClientFromRequest=()=>globalThis.fixtureClient;':a.path==='runtime'?"export const secrets={get:()=>''};":'export async function uploadPreviewBatch(_b,items){return Object.fromEntries(items.map(p=>[p.id,"data:image/jpeg;base64,"+p.previewBase64]));}',loader:'js'}));
}}]});
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
let role='admin';
const rec={id:'test',name:'Fixture',enabled:true,endpoint:'https://api.invalid/v1',api_key:'test',seleccion_models:['test-model'],available_models_meta:[{id:'test-model',caps:{vision:true}}]};
globalThis.fixtureClient={auth:{me:async()=>({role})},asServiceRole:{entities:{CustomAiProvider:{get:async()=>rec},AiProviderConfig:{list:async()=>[{active_seleccion:'custom:test',model_defaults_policy:'verified-three-v1'}]}}}};
const original=globalThis.fetch;
const keys=['technical','sharpness','focus','face_quality','eye_quality','expression','composition','exposure','color_quality','subject_quality','moment_quality','distraction_penalty','overall','confidence'];
let mode='valid';let requests=[];
globalThis.fetch=async(_url,opts)=>{
 const body=JSON.parse(opts.body);requests.push(body);
 const rankings=Array.from({length:6},(_,i)=>({id:'audit-'+(i+1),rank:i+1,status:i===0?'TOP_PICK':'REVIEW',reject_reasons:[],note:'fixture',pose_heads:['back'],face_visibility:'not_visible',...Object.fromEntries(keys.map(k=>[k,['face_quality','eye_quality','expression'].includes(k)?null:75]))}));
 if(mode==='missing')delete rankings[2].focus;
 if(mode==='visible')rankings[2].face_visibility='visible';
 return new Response(JSON.stringify({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:JSON.stringify({keep_ids:['audit-1'],category:'wedding',rankings})}}]}),{status:200});
};
const request=()=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:'audit-selection',id:'test',model:'test-model'})});
try{
 for(mode of ['valid','missing','visible','truncated']){
  requests=[];const response=await handler(request());assert.equal(response.status,200);
  const result=(await response.json()).groups['audit-six'];
  assert.equal(requests.length,1);assert.equal(requests[0].max_tokens,4096);
  assert.equal(requests[0].messages[0].content.filter(c=>c.type==='image_url').length,6);
  assert.equal(result._meta.fallback,mode!=='valid',mode);
  if(mode==='valid')assert.equal(result.rankings.filter(r=>r.analysis_complete).length,6);
 }
 role='user';requests=[];assert.equal((await handler(request())).status,403);assert.equal(requests.length,0);
 role='admin';rec.seleccion_models=[];assert.equal((await handler(request())).status,400);assert.equal(requests.length,0);
}finally{globalThis.fetch=original;delete globalThis.fixtureClient;}
console.log('PASS selection: six real-pipeline inputs, 4096-token budget, complete honest non-visible faces, missing critical/visible-face scores rejected, truncated output rejected, admin-only diagnostics, unmarked model blocked.');
