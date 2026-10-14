import assert from 'node:assert/strict';
import { applyBurstSelectionPolicy } from '../src/lib/rawaistudio/selectionPolicy.js';
function run(entries) {
 const meta = new Map(entries.map(([id, m]) => [id, {groupId:'burst', ...m}]));
 const keep = new Set(); applyBurstSelectionPolicy(keep,meta,[]); return {meta,keep};
}
let r=run([['a',{status:'REJECT',scores:{overall:10}}],['b',{status:'REJECT',scores:{overall:20}}]]);
assert.deepEqual([...r.keep],['b']); assert.equal(r.meta.get('b').rating,5); assert.equal(r.meta.get('a').colorLabel,'red'); assert.equal(r.meta.get('b').selection_fallback,true);
r=run([['a',{status:'SELECT',poseKey:'front',scores:{eye_quality:95,expression:95,sharpness:50}}],['b',{status:'SELECT',poseKey:'front',scores:{eye_quality:5,expression:20,sharpness:100}}],['c',{status:'SELECT',poseKey:'left-profile',scores:{overall:70}}]]);
assert.deepEqual([...r.keep],['a','c']); assert.equal(r.meta.get('b').status,'REVIEW'); assert.equal(r.meta.get('b').rating,3); assert.equal(r.meta.get('b').colorLabel,'yellow');
r=run([['a',{status:'REJECT',poseKey:'front'}],['b',{status:'REJECT',poseKey:'left'}],['c',{status:'REJECT',poseKey:'front'}]]);
assert.equal(r.keep.size,3); // vuelta de cabeza = nueva secuencia, no fusionar a distancia
r=run([['dark',{status:'REJECT'}]]);assert.ok(r.keep.has('dark'));
r=run([['missing',{status:'REVIEW',previewWarning:true}]]);assert.ok(r.keep.has('missing'));assert.equal(r.meta.get('missing').previewWarning,true);
console.log('PASS: all-reject, eyes/expression, head turn, return pose, dark singleton, unavailable preview, labels');
r=run([['a',{status:'SELECT',scores:{eye_quality:80,expression:80,focus:90,sharpness:1}}],['b',{status:'SELECT',scores:{eye_quality:80,expression:80,focus:10,sharpness:100}}]]);assert.ok(r.keep.has('a'));
r=run([['a',{status:'SELECT',scores:{eye_quality:80,expression:null}}],['b',{status:'SELECT',scores:{eye_quality:60,expression:60}}]]);assert.ok(r.keep.has('a'));
r=run([['a',{status:'SELECT',rejectReasons:['EYES_CLOSED'],scores:{overall:100}}],['b',{status:'REVIEW',scores:{overall:50}}]]);assert.ok(r.keep.has('b'));
r=run([['a',{status:'SELECT',poseKey:' Front '}],['b',{status:'REVIEW',poseKey:'unknown'}],['c',{status:'REVIEW',poseKey:'front'}]]);assert.equal(r.keep.size,1);
const unordered = new Map([['c',{groupId:'g',poseKey:'left',status:'SELECT'}],['a',{groupId:'g',poseKey:'front',status:'SELECT'}],['b',{groupId:'g',poseKey:'front',status:'REVIEW'}]]);
const orderedKeep = new Set();applyBurstSelectionPolicy(orderedKeep,unordered,[{id:'a'},{id:'b'},{id:'c'}]);assert.equal(orderedKeep.size,2);assert.equal(unordered.get('a').groupId,unordered.get('b').groupId);
console.log('PASS: focus metric, missing dimensions, closed eyes, unknown pose and asynchronous ordering');
const { readFileSync } = await import('node:fs');
const engine = readFileSync(new URL('../src/lib/rawaistudio/smartSelectionEngine.js', import.meta.url), 'utf8');
const fallbackStart = engine.indexOf('        fb.forEach((m, i) => {');
const fallbackEnd = engine.indexOf('\n      }', fallbackStart);
const fallbackMeta = new Map(), fallbackKeep = new Set();
new Function('fb','burst','keep','meta','groupIdFor','groupSizeFor',engine.slice(fallbackStart,fallbackEnd))(
 [{status:'REVIEW',scores:null}], {files:[{id:'offline'}],independent:false}, fallbackKeep,fallbackMeta,()=> 'burst',()=>1
);
applyBurstSelectionPolicy(fallbackKeep,fallbackMeta,[{id:'offline'}]);assert.ok(fallbackKeep.has('offline'));
console.log('PASS: actual provider-error recovery block does not crash and keeps a representative');

const copies=[{id:'jpg',file:{name:'same.jpg'},captureTime:1000},{id:'raw',file:{name:'same.RAF'},captureTime:1000},{id:'next',file:{name:'next.RAF'},captureTime:1100}];
const copyMeta=new Map([['jpg',{groupId:'burst',poseKey:'left-profile',status:'SELECT',scores:{overall:80}}],['raw',{groupId:'burst',poseKey:'front',status:'SELECT',scores:{overall:85}}],['next',{groupId:'burst',poseKey:'front',status:'SELECT',scores:{overall:90}}]]);
const copyKeep=new Set();applyBurstSelectionPolicy(copyKeep,copyMeta,copies);assert.deepEqual([...copyKeep],['next']);assert.equal(copyMeta.get('jpg').poseKey,'front');
console.log('PASS: same-exposure RAW+JPEG cannot invent separate head-turn groups');
