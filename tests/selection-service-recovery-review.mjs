import assert from "node:assert/strict";
import { build } from "esbuild";
const stubs = {
 "@/api/base44Client": `export const base44={functions:{invoke:async(name,payload)=>globalThis.invokeFixture(payload)}};`,
 "./rawPreviewReader": `export const extractRawPreview=()=>{};export const placeholderPreview=()=>{};`,
 "./groupIntoScenes": `export const groupIntoScenes=items=>Array.from({length:items.length/2},(_,i)=>({id:"g"+i,files:items.slice(i*2,i*2+2)}));`,
 "./perceptualHash": `export const computePHash=()=>0n;export const phashDistance=()=>20;`,
 "./captureTime": `export const readCaptureTimeFromBytes=()=>({});`,
 "./cameraMetadata": `export const readCameraMetadataFromBytes=()=>({});export const readAsShotWhiteBalance=()=>null;`,
 "./skinToneAnalysis": `export const analyzeSkinTone=()=>null;`,
 "./previewDecodeCache": `export const decodePreviewImage=()=>({width:800,height:600});`,
 "./selectionPreviewValidation": `export const prepareSelectionPreview=async preview=>preview;`,
};
await build({entryPoints:["src/lib/rawaistudio/smartSelectionEngine.js"],bundle:true,platform:"node",format:"esm",outfile:"/tmp/service-recovery-engine.mjs",plugins:[{name:"fixtures",setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:stubs[a.path],loader:"js"}));}}]});
const {runAiBurstSelection} = await import("file:///tmp/service-recovery-engine.mjs");
await build({entryPoints:["src/lib/rawaistudio/selectionServiceRecovery.js"],bundle:true,platform:"node",format:"esm",outfile:"/tmp/service-recovery-helper.mjs"});
const {invokeSelectionWithRecovery:recover} = await import("file:///tmp/service-recovery-helper.mjs");
const fail=status=>({data:{groups:{g0:{_meta:{fallback:true,http_status:status,error:"Inference engine abort"}}}}});
let calls=0;
await recover(async()=>{calls++;return fail(500);},{bursts:[]},{wait:async()=>{}});
assert.equal(calls,3);
calls=0;
await recover(async()=>{calls++;return {data:{groups:{g:{_meta:{fallback:true,http_status:429,error:"quota exceeded"}}}}};},{},{wait:async()=>{}});
assert.equal(calls,1);
calls=0;
await assert.rejects(recover(async()=>{calls++;throw Error("ambiguous timeout");},{},{wait:async()=>{}}),/timeout/);
assert.equal(calls,1);
let cancel=false;
calls=0;
assert.equal(await recover(async()=>{calls++;return fail(503);},{},{wait:async()=>{cancel=true;},shouldCancel:()=>cancel}),null);
assert.equal(calls,1);
const realTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn,_ms,...args)=>realTimer(fn,0,...args);
const items = Array.from({length:8},(_,i)=>({id:"p"+i,preview:{dataUrl:"data:image/jpeg;base64,valid",base64:"valid",width:800,height:600},file:{name:"p"+i}}));
const seen=[];
globalThis.invokeFixture=async payload=>{
 const b=payload.bursts[0];seen.push(b.burst_id);
 if(b.burst_id==="g0") return {data:{groups:{g0:{_meta:{fallback:true,http_status:500,error:"Inference engine abort"}}}}};
 return {data:{groups:{[b.burst_id]:{_meta:{fallback:false},rankings:b.photos.map((p,i)=>({id:p.id,analysis_complete:true,status:i===0?"TOP_PICK":"REJECT",rank:i+1,scores:{confidence:.9}})),keep_ids:[b.photos[0].id]}}}};
};
const saved=[];
const result=await runAiBurstSelection(items,()=>{},{onBatch:async({meta})=>saved.push(...meta.keys())});
assert.equal(result.deferred_errors.length,1);
assert.deepEqual(saved,["p2","p3","p4","p5","p6","p7"]);
assert.deepEqual(seen,["g0","g0","g0","g1","g2","g3"]);
assert.ok(!result.meta.has("p0")&&!result.meta.has("p1"));
calls=0;
globalThis.invokeFixture=async payload=>{calls++;const id=payload.bursts[0].burst_id;return {data:{groups:{[id]:{_meta:{fallback:true,http_status:503,error:"service unavailable"}}}}};};
await assert.rejects(runAiBurstSelection(items,()=>{},{}),/varios reintentos/);
assert.equal(calls,9);
globalThis.setTimeout=realTimer;
console.log("PASS actual engine: retry explicit 500, defer isolated burst, continue and save other six photos, no invented result, circuit after three failed bursts; quota/ambiguous timeout not retried; cancellation works");
