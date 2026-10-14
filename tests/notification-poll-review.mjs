import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/hooks/useNotifications.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'mock',setup(b){b.onResolve({filter:/^(react|@\/api\/base44Client|@\/components\/ui\/use-toast)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react'?`export const useRef=v=>({current:v});export const useState=v=>[typeof v==='function'?v():v,()=>{}];export const useCallback=f=>f;export const useEffect=f=>globalThis.__poll.cleanups.push(f());`:a.path.endsWith('base44Client')?`const list=async()=>{globalThis.__poll.calls++;if(globalThis.__poll.fail)throw new Error('Rate limit exceeded');return []};export const base44={entities:{ProjectProcessingJob:{list},AlbumAISelection:{list},ExportJob:{list}}};`:`export const useToast=()=>({toast:()=>{}});`,loader:'js'}));}}]});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const prior={document:globalThis.document,localStorage:globalThis.localStorage,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
try{
 globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
 for(const [visibility,fail] of [['hidden',false],['visible',false],['visible',true]]){
  globalThis.__poll={calls:0,fail,cleanups:[],timers:[],listener:null};
  globalThis.document={visibilityState:visibility,addEventListener:(_e,fn)=>globalThis.__poll.listener=fn,removeEventListener:()=>{}};
  globalThis.setTimeout=(fn,delay)=>{globalThis.__poll.timers.push({fn,delay});return 1};globalThis.clearTimeout=()=>{};
  m.useNotifications();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(globalThis.__poll.calls,visibility==='hidden'?0:3);
  assert.equal(globalThis.__poll.timers.at(-1).delay,visibility==='hidden'?15000:60000);
  if(fail){globalThis.__poll.listener();await new Promise(resolve=>setImmediate(resolve));assert.equal(globalThis.__poll.calls,3,'focus cannot bypass cooldown after 429');}
  globalThis.__poll.cleanups.forEach(fn=>fn());
 }
}finally{Object.assign(globalThis,prior);delete globalThis.__poll;}
console.log('PASS actual notifications: hidden tab performs zero reads, idle polling slows, 429/focus cooldown prevents request storm');
