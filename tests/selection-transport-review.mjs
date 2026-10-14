import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {selectionUpdates} from '../src/modules/proyectos/lib/selectionPersistence.js';
const r=await build({entryPoints:['src/lib/rawaistudio/smartSelectionEngine.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'mock-http',setup(b){b.onResolve({filter:/^@\/api\/base44Client$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const base44={functions:{invoke:async(_name,payload)=>{
const f=globalThis.__selectionFixture;f.calls.push(payload);if(f.failAt===f.calls.length)f.fallback=true;if(f.cancelFirst)f.canceled=true;if(f.reject)throw new Error('timeout');
return{data:{groups:Object.fromEntries(payload.bursts.map(b=>[b.burst_id,{rankings:b.photos.map((p,i)=>({id:p.id,rank:i+1,status:i?'REVIEW':'TOP_PICK',scores:{overall:80,eye_quality:80,expression:80,focus:80},analysis_complete:true})),_meta:{fallback:!!f.fallback,error:f.fallback?'missing JSON':null,provider:'chatgpt',model:'chatgpt-kiko',ia_calls:1}}]))}};
}}};`,loader:'js'}));}}]});
const m=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
function photos(n,bursts=false){return Array.from({length:n},(_,i)=>({id:String(i),file:{name:i+'.RAF'},captureTime:(bursts?Math.floor(i/2):i)*6000+1000,phash:0n,preview:{base64:'small-preview',isPlaceholder:false},technical:{}}));}
try{
 globalThis.__selectionFixture={calls:[]};let progress=[];
 let result=await m.runAiBurstSelection(photos(6,true),(d,t)=>progress.push([d,t]));
 assert.equal(globalThis.__selectionFixture.calls.length,3);assert.ok(globalThis.__selectionFixture.calls.every(p=>p.bursts.length===1));assert.equal(result.keep.size,3);assert.deepEqual(progress.at(-1),[6,6]);
 globalThis.__selectionFixture={calls:[]};await m.runAiBurstSelection(photos(11));assert.deepEqual(globalThis.__selectionFixture.calls.map(p=>p.bursts[0].photos.length),[5,5,1]);
 for(const mode of ['fallback','reject']){globalThis.__selectionFixture={calls:[],[mode]:true};await assert.rejects(m.runAiBurstSelection(photos(6,true)));assert.equal(globalThis.__selectionFixture.calls.length,1,'no additional sends after invalid provider result');}
 globalThis.__selectionFixture={calls:[],failAt:2};const saved=[];
 await assert.rejects(m.runAiBurstSelection(photos(6,true),null,{onBatch:async b=>saved.push(...b.meta.keys())}));assert.deepEqual(saved,['0','1'],'validated first burst checkpoint survives later provider failure');
 const sameHashItems=[{id:'a',fingerprint:{filename:'a.RAF',relative_path:'a.RAF',file_size:10,fingerprint_hash:'same'}},{id:'b',fingerprint:{filename:'b.RAF',relative_path:'b.RAF',file_size:10,fingerprint_hash:'same'}}];
 const u=selectionUpdates(new Map([['a',{status:'SELECT'}],['b',{status:'REVIEW'}]]),sameHashItems,sameHashItems.map(p=>({...p.fingerprint,id:p.id})));
 assert.deepEqual(u.map(row=>[row.id,row.rating,row.color_label]),[['a',5,'green'],['b',3,'yellow']],'identical pHashes must not overwrite each other');
 globalThis.__selectionFixture={calls:[],cancelFirst:true,canceled:false};result=await m.runAiBurstSelection(photos(6,true),null,{shouldCancel:()=>globalThis.__selectionFixture.canceled});assert.equal(globalThis.__selectionFixture.calls.length,1);assert.equal(result.keep.size,0);assert.equal(result.canceled,true);
}finally{delete globalThis.__selectionFixture;}
console.log('PASS actual selection engine: one burst/request, singleton batches 5/5/1, exact photo progress, abort on fallback/timeout, cancellation stops pending sends');
