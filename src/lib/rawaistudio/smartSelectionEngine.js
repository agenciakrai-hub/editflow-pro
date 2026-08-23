// RAW AI Studio — motor de selección inteligente (agrupación de ráfagas + IA), versión
// local: lee las previews de los RAW en el navegador, agrupa ráfagas y llama a la IA
// (rawAiSmartSelect) para decidir qué fotos kept de cada ráfaga. Si la IA falla, conserva
// la mejor toma técnica de cada ráfaga (fallback determinista). Los RAW nunca se suben:
// solo su preview JPEG embebida (decodificada en el navegador) se envía a la IA.
import { base44 } from "@/api/base44Client";
import { extractRawPreview, placeholderPreview } from "./rawPreviewReader";
import { groupIntoBursts } from "./burstGrouping";
import { runPool } from "./promisePool";

const MAX_CANDIDATES = 8;
const BATCH_PHOTOS = 30;
const PREVIEW_CONCURRENCY = 6;
const BATCH_CONCURRENCY = 3;

export function scoreOf(p) {
  return (p.preview.sharpness || 0) * 0.6 + (p.preview.exposureScore || 0) * 0.4;
}

// items: [{id, file}] -> [{id, file, preview}]
export async function extractPreviews(items, onProgress) {
  let done = 0;
  return runPool(items, PREVIEW_CONCURRENCY, async (item) => {
    try { return { ...item, preview: await extractRawPreview(item.file) }; }
    catch { return { ...item, preview: placeholderPreview() }; }
  }, () => { done += 1; onProgress?.(done); });
}

// withPreview: [{id, file, preview}] -> { keep: Set<id>, meta: Map<id,{...}> }
export async function runAiBurstSelection(withPreview, onProgress) {
  const withValidPreview = withPreview.filter((p) => p.preview && !p.preview.isPlaceholder);
  const bursts = groupIntoBursts(withValidPreview);
  const keep = new Set(withPreview.filter((p) => !p.preview || p.preview.isPlaceholder).map((p) => p.id));
  const meta = new Map();

  const batches = [];
  let currentBatch = [];
  let currentBatchPhotoCount = 0;
  const pushBatch = () => {
    if (currentBatch.length) batches.push(currentBatch);
    currentBatch = [];
    currentBatchPhotoCount = 0;
  };

  for (const burst of bursts) {
    const ranked = [...burst.files].sort((a, b) => scoreOf(b) - scoreOf(a));
    const best = ranked[0];
    meta.set(best.id, { groupId: burst.id, groupSize: burst.files.length, complementary: false, reason: null });

    if (burst.files.length === 1) {
      keep.add(best.id);
    } else {
      const candidates = ranked.slice(0, Math.min(MAX_CANDIDATES, ranked.length));
      currentBatch.push({ id: burst.id, bestId: best.id, files: burst.files, candidates });
      currentBatchPhotoCount += candidates.length;
      if (currentBatchPhotoCount >= BATCH_PHOTOS) pushBatch();
    }
  }
  pushBatch();

  let burstsResolved = bursts.length - batches.flat().length;
  onProgress?.(burstsResolved);

  await runPool(batches, BATCH_CONCURRENCY, async (batch) => {
    try {
      const { data } = await base44.functions.invoke("rawAiSmartSelect", {
        bursts: batch.map((b) => ({
          burst_id: b.id,
          best_id: b.bestId,
          photos: b.candidates.map((f) => ({ id: f.id, preview_base64: f.preview.base64 }))
        }))
      });
      batch.forEach((b) => {
        const ids = data?.keep?.[b.id] || [b.bestId];
        const reason = data?.reasons?.[b.id] || null;
        ids.forEach((id) => keep.add(id));
        ids.forEach((id) => meta.set(id, { groupId: b.id, groupSize: b.files.length, complementary: ids.length > 1, reason }));
      });
    } catch {
      batch.forEach((b) => {
        keep.add(b.bestId);
        meta.set(b.bestId, { groupId: b.id, groupSize: b.files.length, complementary: false, reason: null });
      });
    }
  }, (_, i) => {
    burstsResolved += batches[i].length;
    onProgress?.(burstsResolved);
  });

  return { keep, meta };
}

export function buildPhotoFromSelection(p, keep, meta) {
  const m = meta.get(p.id);
  const selected = keep.has(p.id);
  return {
    id: p.id, file: p.file, preview: p.preview, manualRotation: 0,
    aiSelected: selected, selectedForEdit: selected, colorLabel: selected ? "green" : "none", rating: selected ? 5 : 0,
    groupId: m?.groupId || null, groupSize: m?.groupSize || 1,
    complementary: !!m?.complementary, reason: m?.reason || null,
    overallScore: p.preview ? scoreOf(p) : 0
  };
}