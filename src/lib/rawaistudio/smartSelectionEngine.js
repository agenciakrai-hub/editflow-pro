// RAW AI Studio — pipeline de CULLING profesional (multicapa, local-first).
//
// INGEST → PASS 1 (fast cull cliente: integridad + métricas + EXIF captura + pHash)
// → AGRUPACIÓN por escena (tiempo de captura + similitud visual)
// → PASS 2 (deep cull IA: scoring multidimensional + estados comparativos por grupo)
// → DECISIÓN (estados + confianza, conservadora, sin descarte por una sola métrica)
// → DIVERSIDAD / TOP PICKS → ADAPTADOR compatible con el Editor.
//
// Los RAW nunca se suben: solo su preview JPEG embebida (decodificada en el navegador)
// se envía a la IA de selección. Prioridad: PRECISIÓN > CONSERVACIÓN > RANKING > VELOCIDAD.
import { base44 } from "@/api/base44Client";
import { extractRawPreview, placeholderPreview } from "./rawPreviewReader";
import { groupIntoScenes } from "./groupIntoScenes";
import { runPool } from "./promisePool";
import { computePHash } from "./perceptualHash";
import { readCaptureTimeFromBytes } from "./captureTime";
import { readCameraMetadataFromBytes } from "./cameraMetadata";

const MAX_CANDIDATES = 12;     // top por grupo enviadas a la IA (ordenadas por scoreOf)
const BATCH_PHOTOS = 30;       // fotos por llamada IA
const PREVIEW_CONCURRENCY = 6;
const BATCH_CONCURRENCY = 3;

export const STATUSES = ["TOP_PICK", "SELECT", "REVIEW", "REJECT"];

// Métrica técnica pura (solo para ordenar candidatas dentro de un grupo antes de la IA).
// NO es la puntuación final: el ranking lo decide la IA comparando las fotos del grupo.
export function scoreOf(p) {
  return (p.preview.sharpness || 0) * 0.6 + (p.preview.exposureScore || 0) * 0.4;
}

// items: [{id, file}] -> [{id, file, preview, captureTime, phash, cameraInfo, technical}]
// PASS 1: lee el buffer UNA vez y reutiliza para preview + EXIF + cámara + pHash.
export async function extractPreviews(items, onProgress) {
  let done = 0;
  return runPool(items, PREVIEW_CONCURRENCY, async (item) => {
    let bytes = null;
    try { bytes = new Uint8Array(await item.file.arrayBuffer()); } catch { bytes = null; }
    let preview;
    try { preview = await extractRawPreview(item.file, 800, { bytes: bytes || undefined }); }
    catch { preview = placeholderPreview(); }

    // pHash + EXIF + cámara sobre el MISMO buffer (sin releer el RAW del disco).
    const phash = preview?.dataUrl ? await computePHash(preview.dataUrl) : null;
    let captureTime = null, focal = null, aperture = null, iso = null;
    let cameraInfo = null;
    if (bytes) {
      try { const t = readCaptureTimeFromBytes(bytes); ({ captureTime, focal, aperture, iso } = t); } catch {}
      try { cameraInfo = readCameraMetadataFromBytes(bytes); } catch {}
    }

    // Puerta de integridad (solo defectos CLAROS). El resto lo juzga la IA en Pass 2.
    const corrupt = !preview || preview.isPlaceholder;
    const technical = {
      sharpness: preview?.sharpness ?? 0,
      exposureScore: preview?.exposureScore ?? 0.5,
      avgLuminance: preview?.histogram?.avgLuminance ?? null,
      captureTime, focal, aperture, iso,
      corrupt,
    };

    return { ...item, preview, phash, captureTime, cameraInfo, technical };
  }, () => { done += 1; onProgress?.(done); });
}

// withPreview -> { keep: Set<id>, meta: Map<id, {...}> }
export async function runAiBurstSelection(withPreview, onProgress) {
  const valid = withPreview.filter((p) => p.preview && !p.preview.isPlaceholder);
  const groups = groupIntoScenes(valid);

  // Fotos corruptas (sin preview analizable): REVIEW, no se seleccionan ni se mandan a la IA.
  const keep = new Set();
  const meta = new Map();
  withPreview.filter((p) => !p.preview || p.preview.isPlaceholder).forEach((p) => {
    meta.set(p.id, {
      groupId: "corrupt", groupSize: 1, status: "REVIEW",
      scores: null, rejectReasons: ["PREVIEW_UNAVAILABLE"], reason: "Preview no disponible para análisis",
      confidence: 0, category: null, groupRank: 1, complementary: false, category_note: "",
    });
  });

  // Construir lotes de escenas para la IA (todas las fotos del grupo, ordenadas, hasta MAX_CANDIDATES).
  const batches = [];
  let currentBatch = [];
  let currentBatchPhotoCount = 0;
  const pushBatch = () => { if (currentBatch.length) batches.push(currentBatch); currentBatch = []; currentBatchPhotoCount = 0; };

  for (const group of groups) {
    const ranked = [...group.files].sort((a, b) => scoreOf(b) - scoreOf(a));
    const candidates = ranked.slice(0, Math.min(MAX_CANDIDATES, ranked.length));
    currentBatch.push({ id: group.id, files: group.files, candidates });
    currentBatchPhotoCount += candidates.length;
    if (currentBatchPhotoCount >= BATCH_PHOTOS) pushBatch();
  }
  pushBatch();

  let resolved = 0;
  onProgress?.(resolved);

  await runPool(batches, BATCH_CONCURRENCY, async (batch) => {
    try {
      const { data } = await base44.functions.invoke("rawAiSmartSelect", {
        bursts: batch.map((b) => ({
          burst_id: b.id,
          photos: b.candidates.map((f) => ({ id: f.id, preview_base64: f.preview.base64 })),
        })),
      });
      batch.forEach((b) => {
        const g = data?.groups?.[b.id];
        const rankings = Array.isArray(g?.rankings) ? g.rankings : [];
        const byId = new Map(rankings.map((r) => [String(r.id), r]));
        const category = g?.category || null;
        const reason = g?.reason || null;
        const keepIds = new Set((g?.keep_ids || []).map(String));
        b.files.forEach((f, i) => {
          const r = byId.get(f.id);
          const status = r?.status || "REVIEW";
          const groupRank = typeof r?.rank === "number" ? r.rank : i + 1;
          const selectable = status === "SELECT" || status === "TOP_PICK";
          if (selectable) keep.add(f.id);
          meta.set(f.id, {
            groupId: b.id,
            groupSize: b.files.length,
            status,
            scores: r?.scores || null,
            rejectReasons: r?.reject_reasons || [],
            reason: reason,
            confidence: r?.scores?.confidence ?? null,
            category,
            groupRank,
            complementary: keepIds.size > 1 && keepIds.has(f.id) && status !== "TOP_PICK",
            category_note: r?.note || "",
          });
        });
      });
    } catch {
      // Fallo de IA: conservador — cada grupo a REVIEW (no se descarta nada automático).
      batch.forEach((b) => {
        b.files.forEach((f, i) => {
          meta.set(f.id, {
            groupId: b.id, groupSize: b.files.length, status: "REVIEW",
            scores: null, rejectReasons: [], reason: "Análisis IA no disponible",
            confidence: null, category: null, groupRank: i + 1, complementary: false, category_note: "",
          });
        });
      });
    }
    resolved += batch.length;
    onProgress?.(resolved);
  }, () => {});

  return { keep, meta };
}

// ADAPTADOR: produce la forma que el Editor espera (aiSelected, selectedForEdit,
// colorLabel, rating, groupId, reason, overallScore) + campos extra del culling
// (status, scores, rejectReasons, confidence, category, groupRank) que el Editor
// ignora pero la UI de revisión y el XMP usan. Mantiene el contrato del Editor.
const STATUS_COLOR = { TOP_PICK: "green", SELECT: "green", REVIEW: "yellow", REJECT: "red" };
const STATUS_RATING = { TOP_PICK: 5, SELECT: 5, REVIEW: 0, REJECT: 0 };

export function buildPhotoFromSelection(p, keep, meta) {
  const m = meta.get(p.id) || {};
  const status = m.status || (keep.has(p.id) ? "SELECT" : "REVIEW");
  const selected = status === "SELECT" || status === "TOP_PICK";
  return {
    id: p.id, file: p.file, preview: p.preview, manualRotation: 0,
    aiSelected: selected, selectedForEdit: selected,
    colorLabel: STATUS_COLOR[status] || "none",
    rating: STATUS_RATING[status] ?? 0,
    groupId: m.groupId || null, groupSize: m.groupSize || 1,
    complementary: !!m.complementary, reason: m.reason || null,
    overallScore: m.scores?.overall ?? 0,
    status,
    scores: m.scores || null,
    rejectReasons: m.rejectReasons || [],
    confidence: m.confidence ?? null,
    category: m.category || null,
    groupRank: m.groupRank ?? null,
    captureTime: p.captureTime ?? null,
    cameraInfo: p.cameraInfo || null,
  };
}