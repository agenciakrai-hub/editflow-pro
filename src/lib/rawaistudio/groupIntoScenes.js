import { phashDistance } from "./perceptualHash.js";
function nameOf(p) { return p.fingerprint?.filename || p.file?.name || ""; }
function sequence(p) { const m = /(\d+)(?=\.[^.]+$)/.exec(nameOf(p)); return m ? Number(m[1]) : null; }
function timeOf(p) {
 const value = p.captureTime ?? p.fingerprint?.capture_time;
 if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
 const parsed = typeof value === "string" ? Date.parse(value) : NaN;
 return Number.isFinite(parsed) ? parsed : null;
}
function hashOf(p) {
 if (p.phash != null) return p.phash;
 try { return p.fingerprint?.fingerprint_hash ? BigInt("0x" + p.fingerprint.fingerprint_hash) : null; } catch { return null; }
}
function scope(p) {
 const path = p.fingerprint?.relative_path || p.file?.webkitRelativePath || "";
 return JSON.stringify([path.split("/").slice(0,-1).join("/"), p.cameraInfo?.serial || p.fingerprint?.camera_serial || p.cameraInfo?.model || p.fingerprint?.camera_model || ""]);
}
// Plan metadata for the WHOLE folder before loading previews. A burst is never
// split for transport or by a head pose. Anchor comparison prevents scene chaining.
export function groupIntoScenes(items, {gapMs=8000, phashThreshold=16, maxSpanMs=30000}={}) {
 const sorted = [...items].sort((a,b) => scope(a).localeCompare(scope(b)) ||
   ((timeOf(a) ?? 0)-(timeOf(b) ?? 0)) ||
   nameOf(a).localeCompare(nameOf(b), undefined, {numeric:true}) || String(a.id).localeCompare(String(b.id)));
 const groups = [];
 let current;
 for (const item of sorted) {
   const time = timeOf(item), hash = hashOf(item);
   const prev = current?.files.at(-1);
   const dt = time !== null && current?.lastTime !== null ? Math.abs(time-current.lastTime) : null;
   const d = current ? phashDistance(hash,current.lastPhash) : -1;
   const anchorD = current ? phashDistance(hash,current.anchorHash) : -1;
   const seq = sequence(item), prevSeq = prev ? sequence(prev) : null;
   const adjacent = seq !== null && prevSeq !== null && seq-prevSeq >= 0 && seq-prevSeq <= 2;
   const hasTime = dt !== null;
   const close = hasTime ? dt <= gapMs && time-current.firstTime <= maxSpanMs : adjacent;
   // Without reliable EXIF, both sequence adjacency and visual evidence are required.
   const similar = d >= 0 && d <= phashThreshold && anchorD >= 0 && anchorD <= phashThreshold;
   const same = current && scope(item)===current.scope && close && similar;
   if (same) {
     current.files.push(item); current.lastTime=time; current.lastPhash=hash;
   } else {
     current={id:`burst-${item.fingerprint?.id || item.id}`,files:[item],scope:scope(item),firstTime:time,lastTime:time,anchorHash:hash,lastPhash:hash};
     groups.push(current);
   }
 }
 return groups;
}
export function packSceneChunks(groups, maxPhotos=200) {
 const chunks=[]; let chunk=[];
 for (const group of groups) {
   if (chunk.length && chunk.length+group.files.length>maxPhotos) {chunks.push(chunk);chunk=[];}
   chunk.push(...group.files.map(p=>({...p,selectionBurstId:group.id})));
 }
 if(chunk.length)chunks.push(chunk);
 return chunks;
}
