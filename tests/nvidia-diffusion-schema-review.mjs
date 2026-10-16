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

let mode="valid",requests=[];
globalThis.fetch=async(_url,opts)=>{
 const body=JSON.parse(opts.body);requests.push(body);
 if(String(_url).includes("nvidia")){assert.equal(body.response_format.type,"json_schema");assert.equal(body.response_format.json_schema.name,"selection_result");assert(body.response_format.json_schema.schema.required.includes("winner_id"));assert.equal(body.reasoning_effort,undefined);}else assert.equal(body.reasoning_effort,undefined);
 const ids=body.messages[0].content[0].text.match(/exact identifiers: ([^\n]+)/)[1].replace(/\.$/,"").split(", ");
 const answer={winner_id:mode==="unknown"?"alien":ids[1],compared_ids:mode==="missing"?ids.slice(1):ids,reason:"Ojos abiertos y mejor expresión"};
 return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(answer)}}]}),{status:200});
};
const request=()=>new Request("https://test.invalid",{method:"POST",body:JSON.stringify({decision_contract:"burst-winner-v2",bursts:[{burst_id:"one",photos:["a","b","c","d","e","f"].map(id=>({id,preview_base64:"fixture"}))}]})});
try{
 for(const endpoint of ["https://ws-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1","https://integrate.api.nvidia.com/v1","https://openrouter.ai/api/v1"]){
  rec.endpoint=endpoint;
  rec.seleccion_models=[endpoint.includes("nvidia")?"google/diffusiongemma-26b-a4b-it":"qwen3.8-max"];
  rec.available_models_meta=rec.seleccion_models.map(id=>({id,caps:{vision:true},source:"verified"}));
  rec.free_quota_only=!endpoint.includes("nvidia");
  for(mode of ["valid","missing","unknown"]){
   requests=[];const response=await handler(request()),g=(await response.json()).groups.one;
   assert.equal(requests.length,1);assert.equal(g._meta.fallback,mode!=="valid");
   if(mode==="valid"){assert.deepEqual(g.keep_ids,["b"]);assert.equal(g.rankings.filter(r=>r.status==="TOP_PICK").length,1);assert.equal(g.rankings[0].scores,null);}
   else assert.equal(g._meta.failure_kind,"invalid_comparison");
  }
 }
}finally{globalThis.fetch=original;delete globalThis.fixtureClient;}
console.log("PASS actual handler + adapter: Alibaba, NVIDIA, OpenRouter compact winner contract; missing/unknown candidate rejected");