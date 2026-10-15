import assert from 'node:assert/strict';
import {build} from 'esbuild';
const load=async(path,plugins=[])=>{const r=await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false,plugins});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));};
const {isAlibaba,assertFreeQuota,ALIBABA_FREE_UNTIL}=await load('base44/shared/alibabaFreeQuota.ts');
const endpoint='https://ws-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const now=Date.parse('2026-10-15T12:00:00Z');
const rec={name:'Alibaba free',endpoint,api_key:'fixture',enabled:true,free_quota_only:true,free_quota_models:['qwen3.8-max'],free_quota_until:ALIBABA_FREE_UNTIL,seleccion_models:['qwen3.8-max'],available_models_meta:[{id:'qwen3.8-max',caps:{vision:true}}]};
assert.equal(isAlibaba(endpoint),true);
assert.equal(isAlibaba('https://ws-test.ap-southeast-1.maas.aliyuncs.com.evil.invalid/v1'),false);
assert.doesNotThrow(()=>assertFreeQuota(rec,'qwen3.8-max',now));
for(const [r,m,t] of [[rec,'qwen3.8-flash',now],[{...rec,free_quota_only:false},'qwen3.8-max',now],[{...rec,free_quota_until:'bad'},'qwen3.8-max',now],[rec,'qwen3.8-max',Date.parse(ALIBABA_FREE_UNTIL)]]){
 assert.throws(()=>assertFreeQuota(r,m,t),e=>e.freeQuotaOnly===true);
}
const {invokeVision}=await load('base44/shared/aiProviderAdapter.ts',[{name:'mock',setup(b){b.onResolve({filter:/^base44:runtime$/},()=>({path:'runtime',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"export const secrets={get:()=>''};",loader:'js'}));}}]);
const cfg={model_defaults_policy:'verified-three-v1',active_video_chain:['custom:ali','custom:paid'],active_model_video:'qwen3.8-max'};
const seen=[];const original=globalThis.fetch;
globalThis.fetch=async(url,o)=>{seen.push({url,model:JSON.parse(o.body).model});return new Response('quota exhausted',{status:403});};
const b={asServiceRole:{entities:{CustomAiProvider:{get:async(id)=>id==='ali'?rec:{...rec,name:'Paid',endpoint:'https://paid.invalid/v1'}},AiProviderConfig:{list:async()=>[cfg]}}}};
try{
 await assert.rejects(invokeVision(b,{task:'video',prompt:'fixture',file_urls:['data:image/png;base64,abc']}),e=>e.freeQuotaOnly===true);
 assert.equal(seen.length,1);assert.equal(seen[0].model,'qwen3.8-max');assert.ok(seen[0].url.startsWith(endpoint));
 seen.length=0;rec.free_quota_only=false;
 await assert.rejects(invokeVision(b,{task:'seleccion',forceProvider:'custom:ali',forceModel:'qwen3.8-max',prompt:'fixture',file_urls:['data:image/png;base64,abc']}),e=>e.freeQuotaOnly===true);assert.equal(seen.length,0);
}finally{globalThis.fetch=original;}
console.log('PASS Alibaba: expiry, invalid/missing policy, only approved model, no paid video fallback, blocked before send');
