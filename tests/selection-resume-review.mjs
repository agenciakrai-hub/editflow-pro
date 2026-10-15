import assert from "node:assert/strict";
import { build } from "esbuild";
const fingerprints = Array.from({length:2705},(_,i)=>({id:"fp"+i,filename:"photo"+i+".NEF",relative_path:"photo"+i+".NEF",file_size:i+100,fingerprint_hash:"01"}));
const items = fingerprints.map((fp,i)=>({id:"local"+i,file:{name:fp.filename,size:fp.file_size},fingerprint:fp}));
const completed = fingerprints.slice(0,151).map(fp=>fp.id);
const checkpoint = {id:"failedJob",status:"failed",stage_progress:{photos_done:151,completed_fingerprint_ids:completed,resume_scope:"folder"}};
globalThis.fixture = {fingerprints,checkpoint,received:[],writes:[],history:[]};
const mods = {
 "@/api/base44Client": `export const base44={entities:{AlbumAISelection:{get:async()=>globalThis.fixture.checkpoint,updateMany:async()=>{},create:async value=>{globalThis.fixture.history.push(value);return {id:"resumedJob"};},update:async(id,value)=>{globalThis.fixture.history.push(value);}},ProjectFolder:{get:async()=>({})}}};`,
 "../hooks/useProjectStore": `export const listFingerprintsByFolder=async()=>globalThis.fixture.fingerprints;export const bulkUpdateFingerprints=async updates=>{globalThis.fixture.writes.push(...updates);};export const updateFolder=async()=>{};export const updateProject=async()=>{};`,
 "./previewCache": `export const getCachedPreviews=async()=>new Map([["01",{dataUrl:"data:image/jpeg;base64,valid"}]]);export const getCachedPreview=async()=>null;export const cachePreviews=async()=>{};`,
 "@/lib/rawaistudio/selectionPreviewValidation": `export const prepareSelectionPreview=async pv=>pv;`,
 "@/lib/rawaistudio/rawPreviewReader": `export const extractRawPreview=async()=>{throw Error("not expected")};`,
 "@/lib/rawaistudio/perceptualHash": `export const computePHash=async()=>1n;export const phashHex=()=>"01";`,
 "./idbHandles": `export const getHandleRecord=async()=>null;`,
 "@/lib/ai/aiGateway": `export const selectBursts=async(items,progress,options)=>{globalThis.fixture.received.push(...items.map(i=>i.id));const meta=new Map(items.map(i=>[i.id,{status:"TOP_PICK"}]));await options.onBatch({meta});progress(items.length,items.length);return {keep:new Set(items.map(i=>i.id)),meta,trace:{provider:"mock"}};};`
};
await build({entryPoints:["src/modules/proyectos/lib/backgroundAiSelection.js"],bundle:true,platform:"node",format:"esm",outfile:"/tmp/selection-resume-review.mjs",plugins:[{name:"fixtures",setup(b){b.onResolve({filter:/.*/},a=>mods[a.path]?{path:a.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:mods[a.path],loader:"js"}));}}]});
const {startAiSelection} = await import("file:///tmp/selection-resume-review.mjs");
const oldTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn,ms,...args)=>{const timer=oldTimer(fn,ms,...args);timer.unref?.();return timer;};
await new Promise((resolve,reject)=>startAiSelection({projectId:"p",folderId:"f",items,selectedIds:new Set(items.map(i=>i.id)),resumeFrom:checkpoint,onComplete:resolve,onError:reject}));
assert.equal(globalThis.fixture.received.length,2554);
assert.equal(new Set(globalThis.fixture.received).size,2554);
assert.ok(globalThis.fixture.received.every(id=>Number(id.slice(5))>=151));
assert.ok(globalThis.fixture.writes.every(update=>!completed.includes(update.id)));
const last = globalThis.fixture.history.at(-1);
assert.equal(last.status,"completed");
assert.equal(last.stage_progress.photos_done,2705);
assert.equal(last.stage_progress.completed_fingerprint_ids.length,2705);
assert.equal(last.stats.resumed_from,"failedJob");
console.log("PASS: real background orchestrator resumes 2554 unique photos, preserves all 151 previous records, persists total 2705");
