// RAW AI Studio — pipeline de CULLING profesional (multicapa, local-first).
//
// INGEST → PASS 1 (fast cull cliente: integridad + métricas + EXIF captura + pHash)
// → AGRUPACIÓN por escena (tiempo de captura + similitud visual)
// → PASS 2 (deep cull IA: análisis comparativo por grupo, scoring multidimensional,
//    pesos por género, estados comparativos) con concurrencia controlada
// → DECISIÓN (estados + confianza, conservadora, sin descarte por una sola métrica)
// → DEDUP entre grupos (casi-duplicados en seleccionados de grupos distintos)
// → ADAPTADOR compatible con el Editor.
//
// PRIORIDAD: PRECISIÓN > CONSERVACIÓN > RANKING > ESTABILIDAD > VELOCIDAD.
// Los RAW nunca se suben: solo su preview JPEG embebida (decodificada en el navegador)
// se envía a la IA de selección. Se envía el grupo COMPLETO a la IA (sin truncar por
// sharpness/exposure); el backend parte grupos >12 en dos llamadas comparativas.
import { base44 } from "@/api/base44Client";
import { extractRawPreview, placeholderPreview } from "./rawPreviewReader";
import { groupIntoScenes } from "./groupIntoScenes";
import { runPool } from "./promisePool";
import { computePHash, phashDistance } from "./perceptualHash";
import { readCaptureTimeFromBytes } from "./captureTime";
import { readCameraMetadataFromBytes } from "./cameraMetadata";

const BATCH_PHOTOS = 30;       // fotos por llamada IA (lote de grupos)
const PREVIEW_CONCURRENCY = 6;
const BATCH_CONCURRENCY = 3;

// Umbral MUY estricto para considerar dos seleccionados de grupos distintos como
// casi-duplicados (mu más bajo que el de agrupación). Solo se fusionan los
// verdaderamente idénticos: si el momento/expresión/composición difieren, la
// distancia pHash será mayor y NO se fusionan.
const DEDUP_PHASH_THRESHOLD = 4;

export const STATUSES = ["TOP_PICK", "SELECT", "REVIEW", "REJECT"];

// Métrica técnica pura (solo para fallback y ordenar dentro de un grupo cuando la IA
// falla). NO es la puntuación final: el ranking lo decide la IA comparando el grupo.
export function scoreOf(p) {
  const sharp = p.preview?.sharpness ?? 0;
  const exp = p.preview?.exposureScore ?? 0.5;
  return sharp * 0.6 + exp * 0.4;
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

    const phash = preview?.dataUrl ? await computePHash(preview.dataUrl) : null;
    let captureTime = null, focal = null, aperture = null, iso = null;
    let cameraInfo = null;
    if (bytes) {
      try { const t = readCaptureTimeFromBytes(bytes); ({ captureTime, focal, aperture, iso } = t); } catch {}
      try { cameraInfo = readCameraMetadataFromBytes(bytes); } catch {}
    }

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

// Fallback técnico conservador para un grupo cuando la IA no está disponible.
// Conserva la mejor candidata técnicamente válida como REVIEW (o SELECT si es
// claramente superior); el resto a REVIEW. NUNCA simula decisión IA.
function technicalFallbackForGroup(group) {
  const files = group.files || [];
  const valid = files.filter((f) => !f.technical?.corrupt);
  let best = null;
  let bestScore = -1;
  for (const f of valid) {
    const s = scoreOf(f);
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return files.map((f, i) => {
    const isBest = best && f.id === best.id;
    const clearlySuperior = isBest && bestScore > 0.4 && (best.preview?.exposureScore ?? 0) > 0.6;
    return {
      id: f.id,
      rank: isBest ? 1 : i + 1,
      status: isBest ? (clearlySuperior ? "SELECT" : "REVIEW") : "REVIEW",
      reject_reasons: [],
      note: "Evaluación IA no disponible — fallback técnico",
      scores: null,
      analysis_complete: false,
      missing_dimensions: [],
      reason: "AI_UNAVAILABLE_TECHNICAL_FALLBACK",
      confidence: null,
      category: null,
      groupRank: isBest ? 1 : i + 1,
      complementary: false,
      category_note: "",
    };
  });
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
      scores: null, rejectReasons: ["PREVIEW_UNAVAILABLE"],
      reason: "Preview no disponible para análisis",
      confidence: 0, category: null, groupRank: 1, complementary: false, category_note: "",
      analysisComplete: false, missingDimensions: [], previewWarning: true,
    });
  });

  // Construir lotes de escenas para la IA (TODO el grupo, sin truncar por técnica).
  const batches = [];
  let currentBatch = [];
  let currentBatchPhotoCount = 0;
  const pushBatch = () => { if (currentBatch.length) batches.push(currentBatch); currentBatch = []; currentBatchPhotoCount = 0; };

  for (const group of groups) {
    currentBatch.push({ id: group.id, files: group.files });
    currentBatchPhotoCount += group.files.length;
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
          photos: b.files.map((f) => ({
            id: f.id,
            preview_base64: f.preview?.base64,
            technical: {
              sharpness: f.technical?.sharpness ?? 0,
              exposureScore: f.technical?.exposureScore ?? 0.5,
              corrupt: !!f.technical?.corrupt,
            },
          })),
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
            reason,
            confidence: r?.scores?.confidence ?? null,
            category,
            groupRank,
            complementary: keepIds.size > 1 && keepIds.has(f.id) && status !== "TOP_PICK",
            category_note: r?.note || "",
            analysisComplete: r?.analysis_complete ?? false,
            missingDimensions: r?.missing_dimensions || [],
            previewWarning: false,
          });
        });
      });
    } catch {
      // Fallo de IA: fallback técnico conservador POR GRUPO (no todo el lote a REVIEW).
      batch.forEach((b) => {
        const fb = technicalFallbackForGroup(b);
        fb.forEach((m) => {
          if (m.status === "SELECT" || m.status === "TOP_PICK") keep.add(m.id);
          meta.set(m.id, {
            groupId: b.id, groupSize: b.files.length, status: m.status,
            scores: m.scores, rejectReasons: m.rejectReasons, reason: m.reason,
            confidence: m.confidence, category: m.category, groupRank: m.groupRank,
            complementary: m.complementary, category_note: m.category_note,
            analysisComplete: m.analysis_complete, missingDimensions: m.missing_dimensions,
            previewWarning: false,
          });
        });
      });
    }
    resolved += batch.length;
    onProgress?.(resolved);
  }, () => {});

  // DEDUP entre grupos: pHash detecta candidatos; la IA compara visualmente (momento,
  // expresión, composición, sujeto) y solo rebaja si es un duplicado REAL. Diferencia
  // significativa de momento/expresión/composición → NO se consideran duplicados.
  await dedupAcrossGroups(keep, meta, withPreview);

  return { keep, meta };
}

function ctxOf(m) {
  if (!m) return {};
  return { status: m.status, category: m.category, note: m.category_note || m.reason || "" };
}

// Detecta pares con pHash cercano entre grupos y pide a la IA una comparación visual.
// Solo rebaja a REVIEW si la IA confirma duplicado real; conserva ambas en caso contrario.
async function dedupAcrossGroups(keep, meta, withPreview) {
  const selectedIds = Array.from(keep);
  const byId = new Map(withPreview.map((p) => [p.id, p]));
  const pairs = [];
  for (let i = 0; i < selectedIds.length; i++) {
    const a = byId.get(selectedIds[i]);
    if (!a?.phash) continue;
    for (let j = i + 1; j < selectedIds.length; j++) {
      const b = byId.get(selectedIds[j]);
      if (!b?.phash) continue;
      if (meta.get(a.id)?.groupId === meta.get(b.id)?.groupId) continue; // mismo grupo
      const d = phashDistance(a.phash, b.phash);
      if (d >= 0 && d <= DEDUP_PHASH_THRESHOLD) {
        pairs.push({
          pair_id: `pair_${i}_${j}`,
          id_a: a.id, id_b: b.id,
          preview_a_base64: a.preview?.base64, preview_b_base64: b.preview?.base64,
          context_a: ctxOf(meta.get(a.id)),
          context_b: ctxOf(meta.get(b.id)),
        });
      }
    }
  }
  if (!pairs.length) return;
  try {
    const { data } = await base44.functions.invoke("rawAiDedupCompare", { pairs });
    const decisions = data?.decisions || {};
    for (const pair of pairs) {
      const dec = decisions[pair.pair_id];
      if (!dec || !dec.duplicate || !dec.demote) continue;
      const loserId = dec.demote === "a" ? pair.id_a : pair.id_b;
      keep.delete(loserId);
      const m = meta.get(loserId);
      if (m) {
        m.status = "REVIEW";
        m.rejectReasons = [...(m.rejectReasons || []), "DUPLICATE_NEAR_DUPLICATE_IN_SESSION"];
        m.reason = dec.reason || "Casi-duplicado de otra foto seleccionada";
      }
    }
  } catch {
    // IA no disponible: no se rebaja nada (conservador). Se conservan ambas.
  }
}

// ADAPTADOR: produce la forma que el Editor espera (aiSelected, selectedForEdit,
// colorLabel, rating, groupId, reason, overallScore) + campos extra del culling
// (status, scores, rejectReasons, confidence, category, groupRank, analysisComplete,
// missingDimensions) que el Editor ignora pero la UI de revisión y el XMP usan.
// Mantiene el contrato del Editor.
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
    analysisComplete: m.analysisComplete ?? false,
    missingDimensions: m.missingDimensions || [],
    previewWarning: m.previewWarning || false,
  };
}