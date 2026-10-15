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
const rec={free_quota_only:true,free_quota_models:['qwen3.8-max'],free_quota_until:'2026-10-30T16:00:00Z',id:'test',name:'Fixture',enabled:true,endpoint:'https://api.invalid/v1',api_key:'test',seleccion_models:['qwen3.8-max'],available_models_meta:[{id:'qwen3.8-max',caps:{vision:true}}]};
globalThis.fixtureClient={auth:{me:async()=>({role})},asServiceRole:{entities:{CustomAiProvider:{get:async()=>rec},AiProviderConfig:{list:async()=>[{active_seleccion:'custom:test',model_defaults_policy:'verified-three-v1'}]}}}};
const original=globalThis.fetch;
const keys=['technical','sharpness','focus','face_quality','eye_quality','expression','composition','exposure','color_quality','subject_quality','moment_quality','distraction_penalty','overall','confidence'];
let mode='valid';let requests=[];
globalThis.fetch=async(_url,opts)=>{
 const body=JSON.parse(opts.body);requests.push(body);
 const rankings=Array.from({length:9},(_,i)=>({id:'audit-'+(i+1),rank:i+1,status:i===0?'TOP_PICK':'REVIEW',reject_reasons:[],note:'fixture',pose_heads:['back'],face_visibility:'not_visible',...Object.fromEntries(keys.map(k=>[k,['face_quality','eye_quality','expression'].includes(k)?null:75]))}));
 if(mode==='missing')delete rankings[2].focus;
 if(mode==='visible')rankings[2].face_visibility='visible';
 return new Response(JSON.stringify({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:JSON.stringify({keep_ids:['audit-1'],category:'wedding',rankings})}}]}),{status:200});
};

const request=()=>new Request('https://test.invalid',{method:'POST',body:JSON.stringify({bursts:[{burst_id:'nine',photos:Array.from({length:9},(_,i)=>({id:'audit-'+(i+1),preview_base64:'fixture'}))}]})});
try {
 for(const endpoint of ['https://ws-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1','https://integrate.api.nvidia.com/v1','https://openrouter.ai/api/v1']) {
  rec.endpoint=endpoint;
  for(mode of ['valid','missing','visible','truncated']) {
   requests=[];const response=await handler(request());assert.equal(response.status,200);
   const result=(await response.json()).groups.nine;
   assert.equal(requests.length,1);
   assert.equal(requests[0].max_tokens,5632);
   assert.equal(requests[0].messages[0].content.filter(c=>c.type==='image_url').length,9);
   if(endpoint.includes('aliyuncs.com')) {
    assert.equal(requests[0].response_format,undefined);
    assert.equal(requests[0].enable_thinking,false);
    assert.match(requests[0].messages[0].content[0].text,/FORMATO OBLIGATORIO/);
   } else assert.deepEqual(requests[0].response_format,{type:'json_object'});
   assert.equal(result._meta.fallback,mode!=='valid');
   if(mode==='valid') assert.equal(result.rankings.filter(r=>r.analysis_complete).length,9);
  }
 }
} finally { globalThis.fetch=original;delete globalThis.fixtureClient; }
console.log('PASS actual nine-photo handler: Alibaba prompt JSON without response_format; NVIDIA/OpenRouter JSON mode preserved; incomplete, missing-face and truncated results rejected');
