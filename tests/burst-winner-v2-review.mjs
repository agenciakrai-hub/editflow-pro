import assert from "node:assert/strict";
import {build} from "esbuild";
import {compareBurstWinner} from "../base44/shared/burstWinner.js";
import {groupIntoScenes,packSceneChunks} from "../src/lib/rawaistudio/groupIntoScenes.js";
import {applyBurstSelectionPolicy} from "../src/lib/rawaistudio/selectionPolicy.js";
const photo=(i,t=100000+i*1000,h=1n)=>({id:"p"+i,file:{name:"IMG_"+String(i).padStart(4,"0")+".NEF"},captureTime:t,phash:h});
const photos=Array.from({length:10},(_,i)=>photo(i));
const groups=groupIntoScenes(photos);assert.equal(groups.length,1);
assert.equal(groupIntoScenes([photo(1),photo(2,102000,0xffffffffffffffffn)]).length,2);
assert.equal(groupIntoScenes([photo(1),photo(2,120000)]).length,2);
assert.equal(groupIntoScenes([photo(1,null),photo(2,null)]).length,1);
assert.equal(groupIntoScenes([photo(1,null,null),photo(2,null,null)]).length,2);
const many=Array.from({length:205},(_,i)=>({id:"g"+i,files:[photo(i,i*60000)]}));
many[199].files.push(photo(900,199*60000+1000));
const chunks=packSceneChunks(many);
assert(chunks.some(chunk=>chunk.some(p=>p.id==="p199")&&chunk.some(p=>p.id==="p900")));
const ids=Array.from({length:35},(_,i)=>"x"+i),seen=[];
const winner=await compareBurstWinner(ids,async batch=>{seen.push(...batch);return{winner_id:batch.at(-1),compared_ids:batch,reason:"Mejor expresión"};});
assert.equal(winner.keep_ids.length,1);assert.equal(winner.winner_id,"x34");
assert(ids.every(id=>seen.includes(id)));
for(const bad of [{winner_id:"alien",compared_ids:["a","b"],reason:"x"},{winner_id:"a",compared_ids:["a"],reason:"x"},{winner_id:"a",compared_ids:["a","a"],reason:"x"},{winner_id:"a",compared_ids:["a","b"],reason:""}]){
 await assert.rejects(()=>compareBurstWinner(["a","b"],async()=>bad),/incompleta/);
}
const keep=new Set(),meta=new Map([["a",{groupId:"one",status:"TOP_PICK",analysisComplete:true,poseKey:"front"}],["b",{groupId:"one",status:"SELECT",analysisComplete:true,poseKey:"back",scores:{overall:100}}]]);
applyBurstSelectionPolicy(keep,meta);assert.deepEqual([...keep],["a"]);assert.equal(meta.get("b").status,"REVIEW");
applyBurstSelectionPolicy(keep,meta);assert.equal(keep.size,1);
const mods={
"@/api/base44Client":'export const base44={functions:{invoke:async(name,payload)=>globalThis.fixture.invoke(payload)}};',
"./selectionPreviewValidation":'export const prepareSelectionPreview=async p=>p?.base64?p:null;',
"./rawPreviewReader":'export const extractRawPreview=async()=>null;export const placeholderPreview=()=>null;',
"./previewDecodeCache":'export const decodePreviewImage=async()=>null;'
};
await build({entryPoints:["src/lib/rawaistudio/smartSelectionEngine.js"],outfile:"/tmp/burst-engine-v2.mjs",bundle:true,platform:"node",format:"esm",plugins:[{name:"fixtures",setup(b){b.onResolve({filter:/.*/},a=>mods[a.path]?{path:a.path,namespace:"fixture"}:null);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:mods[a.path],loader:"js"}));}}]});
const {runAiBurstSelection}=await import("file:///tmp/burst-engine-v2.mjs?"+Date.now());
const batches=[];let calls=0;
globalThis.fixture={invoke:async payload=>{
 calls++;const burst=payload.bursts[0],ids=burst.photos.map(p=>p.id);
 assert(ids.length<=8);assert.equal(payload.decision_contract,"burst-winner-v2");
 const result=await compareBurstWinner(ids,async ids=>({winner_id:ids.at(-1),compared_ids:ids,reason:"Ganadora comparativa"}));
 return{data:{groups:{[burst.burst_id]:{...result,_meta:{fallback:false}}}}};
}};
const groupPhotos=Array.from({length:25},(_,i)=>({...photo(i),preview:{base64:"jpeg"},selectionBurstId:"whole"}));
const result=await runAiBurstSelection(groupPhotos,null,{onBatch:async b=>batches.push(b)});
assert.equal(calls,5);assert.equal(batches.length,1);assert.equal(result.keep.size,1);assert.equal(result.meta.size,25);
assert.equal([...result.keep][0],"p24");assert.equal(result.meta.get("p24").scores,null);
// An unreadable group stays pending while the following group is committed.
const partial=await runAiBurstSelection([{...photo(50),selectionBurstId:"bad"}, {...photo(51),selectionBurstId:"good",preview:{base64:"jpeg"}}],null,{onBatch:async()=>{}});
assert.equal(partial.meta.size,1);assert.equal(partial.deferred_errors.length,1);
console.log("PASS: grouping, whole-burst chunks, complete tournament, malformed contracts, pose immunity, model winner, persistence boundary and isolated preview failure");
