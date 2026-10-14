import assert from 'node:assert/strict';import {build} from 'esbuild';
const mocks={
 aiGateway:`export const selectBursts=async(items,_p,opts)=>{const meta=new Map(items.map((p,i)=>[p.id,{status:i?'REVIEW':'TOP_PICK'}]));await opts.onBatch({meta});if(globalThis.__selSave.failLater)throw new Error('missing JSON');return{meta,keep:new Set([items[0].id]),trace:{bursts:[]}};};`,
 previewCache:`export const getCachedPreviews=async()=>new Map([['00',{dataUrl:'data:image/jpeg;base64,abc'}]]);`,
 base44Client:`const f=()=>globalThis.__selSave;export const base44={entities:{AlbumAISelection:{updateMany:async()=>{},create:async()=>{if(f().failRegister)throw new Error('record denied');return{id:'job'}},update:async(_id,row)=>f().history.push(row)},ProjectFolder:{update:async(_id,row)=>f().folders.push(row)},Project:{update:async()=>{}},ProjectPhotoFingerprint:{filter:async()=>f().fps,bulkUpdate:async rows=>{if(f().failSave)throw new Error('save failed');f().writes.push(rows);return rows;}}}};`
};
const r=await build({entryPoints:['src/modules/proyectos/lib/backgroundAiSelection.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'boundary',setup(b){b.onResolve({filter:/.*/},a=>{const n=a.path.split('/').pop();if(mocks[n])return{path:n,namespace:'mock'}});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
const m=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...a)=>ms===120000||ms===5000?0:timer(fn,ms,...a);
try{
 for(const mode of ['ok','failRegister','failSave','failLater']){
 const fps=['a','b'].map(id=>({id,filename:id+'.RAF',relative_path:id+'.RAF',file_size:10,fingerprint_hash:'00'}));const items=fps.map(p=>({id:p.id,file:{name:p.filename},fingerprint:p}));globalThis.__selSave={fps,history:[],folders:[],writes:[],[mode]:true};let job;
 const outcome=await new Promise(resolve=>job=m.startAiSelection({projectId:'project',folderId:mode,items,selectedIds:new Set(['a','b']),onComplete:()=>resolve('completed'),onError:()=>resolve('failed')}));
 assert.equal(outcome,mode==='ok'?'completed':'failed');
 assert.equal(globalThis.__selSave.history.some(x=>x.status==='completed'),mode==='ok');
 if(mode==='failLater'){assert.equal(job.results.size,2);assert.equal(globalThis.__selSave.writes.length,1);assert.equal(globalThis.__selSave.history.find(x=>x.stage_progress)?.stage_progress.photos_done,2,'checkpoint stored before later provider failure');}
 if(mode==='failRegister'||mode==='failSave')assert.equal(globalThis.__selSave.writes.length,0);
 if(mode==='ok')assert.equal(job.status,'completed');
 }
}finally{globalThis.setTimeout=timer;delete globalThis.__selSave;}
console.log('PASS actual background selection: registration/save failures explicit; validated checkpoint survives later error; completed only after writes');
