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
