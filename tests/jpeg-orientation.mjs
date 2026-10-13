import assert from 'node:assert/strict';
import {normalizeJpegOrientation} from '../src/lib/rawaistudio/jpegOrientation.js';
for(const little of [true,false]) for(const orientation of [1,3,6,8]) {
 const b=new Uint8Array(40);b.set([255,216,255,225,0,34,69,120,105,102,0,0]);b[12]=b[13]=little?73:77;
 const v=new DataView(b.buffer);v.setUint16(14,42,little);v.setUint32(16,8,little);v.setUint16(20,1,little);
 v.setUint16(22,274,little);v.setUint16(24,3,little);v.setUint32(26,1,little);v.setUint16(30,orientation,little);b.set([255,217],38);
 const normalized=normalizeJpegOrientation(b);assert.equal(new DataView(normalized.buffer).getUint16(30,little),1);assert.equal(v.getUint16(30,little),orientation);
 assert.deepEqual(normalizeJpegOrientation(normalized),normalized);
}
assert.deepEqual(normalizeJpegOrientation(new Uint8Array([255,216,255,217])),new Uint8Array([255,216,255,217]));
console.log('PASS: EXIF endian, orientations, no source mutation, idempotence, no EXIF');
