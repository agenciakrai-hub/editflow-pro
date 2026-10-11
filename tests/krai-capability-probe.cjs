const assert=require('node:assert/strict');const fs=require('node:fs');const esbuild=require('esbuild');
let source=fs.readFileSync('base44/shared/capabilityResolver.ts','utf8').replace(/^import .*;$/gm,'');
let compiled=esbuild.transformSync(source,{loader:'ts',format:'cjs'}).code;
let calls=0,parallel=0,budgets=[];
const fakeFetch=async()=>{calls++;return {ok:false,status:503,text:async()=> 'busy'};};
const run=async(items,limit,fn)=>{parallel=limit;for(const item of items)await fn(item);};
const mod={exports:{}};new Function('exports','module','fetch','runWithConcurrency','isKraiGateway','setTimeout','clearTimeout',compiled)(mod.exports,mod,fakeFetch,run,u=>u.includes('connect.krai.es'),(fn,ms)=>{budgets.push(ms);return 1},()=>{});
(async()=>{let models=[{id:'chatgpt-kiko',caps:{vision:null}},{id:'gemini',caps:{vision:null}}];let result=await mod.exports.probeVisionAutomatic(models,'https://connect.krai.es/api/gateway/v1','dummy');assert.equal(calls,2);assert.equal(parallel,1);assert.deepEqual(budgets,[100000,100000]);assert.equal(result[0].caps.vision,null);console.log('KRAI capability probes: one attempt per model, sequential, 100s budget, transient error stays unverified');})().catch(e=>{console.error(e);process.exitCode=1});
