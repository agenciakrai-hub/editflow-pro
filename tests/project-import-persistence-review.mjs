import assert from 'node:assert/strict';
import {build} from 'esbuild';
const mocks={
 rawPreviewReader:`export const isRawFile=()=>true; export const isHiddenOrSystemFile=()=>false;`,
 smartSelectionEngine:`export const extractPreviews=async items=>items.map(x=>({...x,preview:{dataUrl:'preview'}}));`,
 projectFingerprint:`export const computeFingerprint=async({file})=>({filename:file.name,relative_path:file.name,file_size:10,fingerprint_hash:'abc',capture_time:null});`,
 idbHandles:`export const saveHandle=async()=>'';`,
 previewCache:`export const cachePreviews=async()=>{};`,
 base44Client:`export const base44={entities:{ProjectFolder:{update:async()=>{}},Project:{update:async()=>{}},ProjectProcessingJob:{create:async()=>({id:'history'}),update:async(_id,row)=>globalThis.__importTest.history.push(row)},ProjectPhotoFingerprint:{count:async()=>globalThis.__importTest.saved,upsert:async rows=>{if(globalThis.__importTest.fail)throw new Error('save failed');for(const r of rows){if('capture_time' in r)throw new Error('invalid null date');if('rating' in r)throw new Error('selection overwritten');}globalThis.__importTest.saved+=rows.length;}}}};`
};
const result=await build({entryPoints:['src/modules/proyectos/lib/backgroundProcessor.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'mock-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{const name=args.path.split('/').pop();if(mocks[name])return{path:name,namespace:'mock'};});b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>ms===120000?0:timer(fn,ms,...args);
try{
 for(const fail of [true,false]){
  globalThis.__importTest={fail,saved:0,history:[]};const statuses=[];let job;
  const outcome=await new Promise(resolve=>{job=m.startProcessing({projectId:'test',folderId:fail?'failed':'ok',files:[{name:'a.RAF'},{name:'b.RAF'}],onProgress:s=>statuses.push(s.status),onComplete:()=>resolve('completed'),onError:()=>resolve('failed')});});
  assert.equal(outcome,fail?'failed':'completed');assert.equal(job.items.length,2);
  if(fail)assert.ok(!statuses.includes('completed'),'failed persistence must never report completed');
  else assert.equal(globalThis.__importTest.saved,2);
 }
}finally{globalThis.setTimeout=timer;delete globalThis.__importTest;}
console.log('PASS actual import: save errors surfaced, items retained, completion waits for persistence, missing date omitted and selection preserved');
