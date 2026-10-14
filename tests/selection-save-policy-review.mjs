import assert from 'node:assert/strict';
import {curatedStatus,curatedLabel} from '../src/modules/proyectos/lib/selectionSavePolicy.js';
for(const marked of [true,false]){
 for(const status of ['REVIEW','SELECT']){const p={status,rating:0,marked};assert.equal(curatedStatus(p),'REVIEW');assert.equal(curatedLabel(p),'none');}
 assert.equal(curatedStatus({status:'TOP_PICK',rating:5,marked}),'TOP_PICK');assert.equal(curatedLabel({status:'REVIEW',rating:3,marked}),'yellow');assert.equal(curatedLabel({status:'REJECT',rating:0,marked}),'red');
}
const folder=[...Array.from({length:149},()=>({status:'TOP_PICK',rating:5})),...Array.from({length:576},()=>({status:'SELECT',rating:0}))];assert.equal(folder.filter(p=>curatedStatus(p)==='TOP_PICK').length,149);assert.equal(folder.filter(p=>curatedLabel(p)==='green').length,149);
console.log('PASS marking for processing never validates photos; unrated old promotions recover neutral; genuine curation preserved');
