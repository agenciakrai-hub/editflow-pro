import assert from 'node:assert/strict';
import {albumReadRetry,readAlbumPages,writeAlbumBatches} from '../src/modules/album/hooks/albumReadRetry.js';
let calls=0;const waits=[];const value=await albumReadRetry(async()=>{if(++calls<3)throw{status:429};return'loaded'},async ms=>waits.push(ms));assert.equal(value,'loaded');assert.deepEqual(waits,[1000,2000]);
calls=0;await assert.rejects(()=>albumReadRetry(async()=>{calls++;throw Error('Unauthorized')},async()=>{}),/Unauthorized/);assert.equal(calls,1);
const all=Array.from({length:2401},(_,id)=>({id}));const result=await readAlbumPages({filter:async(q,s,limit,skip)=>all.slice(skip,skip+limit)},{},'id');assert.equal(result.length,2401);assert.deepEqual(result,all);
const batches=[];const written=await writeAlbumBatches({bulkCreate:async rows=>{batches.push(rows.length);return rows}},'bulkCreate',all);assert.deepEqual(batches,[400,400,400,400,400,400,1]);assert.deepEqual(written,all);
console.log('PASS: rate limit retry bounded, no auth retries, all 2401 photos loaded, safe write batches');
