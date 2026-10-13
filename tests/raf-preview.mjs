import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractRafJpeg } from '../src/lib/rawaistudio/rafPreview.js';
const raw = new Uint8Array(200);
raw.set(new TextEncoder().encode('FUJIFILMCCD-RAW '));
const view = new DataView(raw.buffer);view.setUint32(84,100);view.setUint32(88,40);
raw.set([255,216,255,225],100);raw.set([255,216,255,217],115);raw.set([255,217],138);
assert.equal(extractRafJpeg(raw).length,40); // miniatura interna no corta el JPEG
assert.equal(extractRafJpeg(new Uint8Array(200)),null);
view.setUint32(88,300);assert.throws(()=>extractRafJpeg(raw),/límites/);
view.setUint32(88,40);raw[139]=0;assert.throws(()=>extractRafJpeg(raw),/incompleta/);
for (const path of process.argv.slice(2)) {
 const bytes = new Uint8Array(readFileSync(path));const jpeg = extractRafJpeg(bytes);
 assert.ok(jpeg.length > 100000);console.log('RAF válido:',path.split('/').at(-1),jpeg.length,'bytes');
}
console.log('PASS: RAF declarado, miniatura anidada, límites y truncamiento');
