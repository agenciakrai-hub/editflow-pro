import assert from 'node:assert/strict';
import {findEmbeddedJpegSegments} from '../src/lib/rawaistudio/jpegSegments.js';
const jpeg=new Uint8Array([255,216,255,225,0,8,255,216,255,217,1,2,255,192,0,8,8,0,8,0,8,1,255,218,0,2,1,2,255,0,3,255,217]);
assert.equal(findEmbeddedJpegSegments(jpeg)[0].length,jpeg.length);
assert.equal(findEmbeddedJpegSegments(jpeg.slice(0,-2)).length,0);
assert.equal(findEmbeddedJpegSegments(new Uint8Array([255,216,255,217])).length,0);
const combined=new Uint8Array([...jpeg,...jpeg]);assert.equal(findEmbeddedJpegSegments(combined).length,2);
const raw=jpeg.slice();raw[13]=195;assert.equal(findEmbeddedJpegSegments(raw).length,0);
console.log('PASS: Exif nested JPEG, truncation, false sensor marker, distinct images, lossless RAW');
