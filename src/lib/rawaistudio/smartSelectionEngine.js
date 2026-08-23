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

  // Una invocación por ráfaga (en lugar de un lote único) para que el progreso avance de
  // 1 en 1 y una llamada lenta o caída no bloquee todo el proceso. Misma concurrencia (3)
  // y mismo nº total de llamadas IA — solo cambia la granularidad del progreso.
  const bursts = groups.map((g) => ({ id: g.id, files: g.files }));
  const totalBursts = bursts.length;
  let resolved = 0;
  onProgress?.(resolved, totalBursts);

  await runPool(bursts, BATCH_CONCURRENCY, async (burst) => {
    try {
      const { data } = await base44.functions.invoke("rawAiSmartSelect", {
        bursts: [{
          burst_id: burst.id,
          photos: burst.files.map((f) => ({
            id: f.id,
            preview_base64: f.preview?.base64,
            technical: {
              sharpness: f.technical?.sharpness ?? 0,
              exposureScore: f.technical?.exposureScore ?? 0.5,
              corrupt: !!f.technical?.corrupt,
            },
          })),
        }],
      });
      const g = data?.groups?.[burst.id];
      const rankings = Array.isArray(g?.rankings) ? g.rankings : [];
      const byId = new Map(rankings.map((r) => [String(r.id), r]));
      const category = g?.category || null;
      const reason = g?.reason || null;
      const keepIds = new Set((g?.keep_ids || []).map(String));
      burst.files.forEach((f, i) => {
        const r = byId.get(f.id);
        const status = r?.status || "REVIEW";
        const groupRank = typeof r?.rank === "number" ? r.rank : i + 1;
        const selectable = status === "SELECT" || status === "TOP_PICK";
        if (selectable) keep.add(f.id);
        meta.set(f.id, {
          groupId: burst.id,
          groupSize: burst.files.length,
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
    } catch {
      // Fallo de IA: fallback técnico conservador POR RÁFAGA.
      const fb = technicalFallbackForGroup(burst);
      fb.forEach((m) => {
        if (m.status === "SELECT" || m.status === "TOP_PICK") keep.add(m.id);
        meta.set(m.id, {
          groupId: burst.id, groupSize: burst.files.length, status: m.status,
          scores: m.scores, rejectReasons: m.rejectReasons, reason: m.reason,
          confidence: m.confidence, category: m.category, groupRank: m.groupRank,
          complementary: m.complementary, category_note: m.category_note,
          analysisComplete: m.analysis_complete, missingDimensions: m.missing_dimensions,
          previewWarning: false,
        });
      });
    }
    resolved += 1;
    onProgress?.(resolved, totalBursts);
  }, () => {});

  // DEDUP entre grupos: pHash detecta candidatos; la IA compara visualmente (momento,
  // expresión, composición, sujeto) y solo rebaja si es un duplicado REAL. Diferencia
  // significativa de momento/expresión/composición → NO se consideran duplicados.
  await dedupAcrossGroups(keep, meta, withPreview);

  // ORDEN: dedup → cobertura por grupo → mínimo 1 TOP_PICK global.
  const coverage = ensureCoveragePerGroup(keep, meta, withPreview);
  const fallback = ensureAtLeastOneTopPick(keep, meta, withPreview);

  return {
    keep, meta,
    selection_fallback: fallback.selection_fallback,
    fallback_reason: fallback.fallback_reason,
    selection_coverage_fallback: coverage.selection_coverage_fallback,
    coverage_promotions: coverage.promotions,
  };
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

// Puntuación utilizable para el fallback determinista: prioriza el overall de la IA
// (ya producido por el motor); si no está disponible (p.ej. fallback técnico), usa la
// métrica técnica local (sharpness + exposición). NUNCA llama a la IA.
function fallbackScoreOf(m, p) {
  const ov = m?.scores?.overall;
  if (typeof ov === "number" && isFinite(ov)) return ov;
  if (p) return scoreOf(p);
  return 0;
}

// GARANTÍA determinista: el resultado de selección SIEMPRE debe tener al menos una
// foto seleccionada (TOP_PICK). Post-procesado puro del resultado IA existente: no
// hace una segunda llamada a IA ni gasta créditos. Reglas:
//   1. Si ya existe >=1 TOP_PICK → no hacer nada (comportamiento normal).
//   2. Si 0 TOP_PICK pero hay SELECT → promocionar el SELECT de mayor puntuación a TOP_PICK.
//   3. Si tampoco hay SELECT → elegir la mejor candidata no rechazada (REVIEW) por
//      puntuación y promocionarla a TOP_PICK (implica SELECT/5★/verde/cola de edición).
//   4. Si todo está REJECT → promocionar la de mayor puntuación de todas (último recurso).
// Devuelve { selection_fallback, fallback_reason } y marca la foto promocionada.
function ensureAtLeastOneTopPick(keep, meta, withPreview) {
  const byId = new Map(withPreview.map((p) => [p.id, p]));
  const entries = Array.from(meta.entries());

  if (entries.some(([, m]) => m.status === "TOP_PICK")) {
    return { selection_fallback: false, fallback_reason: null };
  }

  let chosen = entries.filter(([, m]) => m.status === "SELECT");
  let fallback_reason = "no_top_pick";
  if (!chosen.length) {
    chosen = entries.filter(([, m]) => m.status !== "REJECT" && !m.previewWarning);
  }
  if (!chosen.length) {
    chosen = entries; // último recurso: incluso entre REJECT
    fallback_reason = "no_selectable";
  }
  if (!chosen.length) return { selection_fallback: false, fallback_reason: null };

  chosen.sort((a, b) => fallbackScoreOf(b[1], byId.get(b[0])) - fallbackScoreOf(a[1], byId.get(a[0])));
  const [id, m] = chosen[0];
  m.status = "TOP_PICK";
  m.groupRank = 1;
  m.rejectReasons = [];
  keep.add(id);
  m.selection_fallback = true;
  m.fallback_reason = fallback_reason;
  return { selection_fallback: true, fallback_reason };
}

// GARANTÍA de cobertura por grupo/ráfaga (post-procesado, sin IA, sin créditos):
// cada grupo de fotos similares debe tener al menos 1 foto seleccionada. Solo
// AÑADE representantes; nunca quita selecciones existentes de Qwen. Si un grupo no
// tiene ninguna TOP_PICK/SELECT, promociona la mejor candidata del grupo a SELECT
// (preferimos no-REJECT; si todo es REJECT, último recurso la mejor de todas).
// Trazabilidad: selection_coverage_fallback=true y, por promoción,
// coverage_fallback_group / coverage_fallback_photo / coverage_fallback_reason.
function ensureCoveragePerGroup(keep, meta, withPreview) {
  const byId = new Map(withPreview.map((p) => [p.id, p]));
  const byGroup = new Map();
  for (const [id, m] of meta) {
    if (!m || m.previewWarning) continue; // corrupt: no se promociona
    const g = m.groupId || "ungrouped";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push([id, m]);
  }
  let coverage = false;
  const promotions = [];
  for (const [groupId, items] of byGroup) {
    const hasSelected = items.some(([, m]) => m.status === "TOP_PICK" || m.status === "SELECT");
    if (hasSelected) continue;
    let pool = items.filter(([, m]) => m.status !== "REJECT");
    if (!pool.length) pool = items; // último recurso: grupo totalmente REJECT
    if (!pool.length) continue;
    pool.sort((a, b) => fallbackScoreOf(b[1], byId.get(b[0])) - fallbackScoreOf(a[1], byId.get(a[0])));
    const [id, m] = pool[0];
    m.status = "SELECT";
    m.rejectReasons = [];
    keep.add(id);
    m.coverage_fallback = true;
    m.coverage_fallback_group = groupId;
    m.coverage_fallback_photo = id;
    m.coverage_fallback_reason = "no_selected_in_group";
    coverage = true;
    promotions.push({ group: groupId, photo: id, reason: "no_selected_in_group" });
  }
  return { selection_coverage_fallback: coverage, promotions };
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
    selectionFallback: !!m.selection_fallback,
    fallbackReason: m.fallback_reason || null,
  };
}