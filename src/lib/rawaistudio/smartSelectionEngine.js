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
import { readCameraMetadataFromBytes, readAsShotWhiteBalance } from "./cameraMetadata";
import { analyzeSkinTone } from "./skinToneAnalysis";
import { decodePreviewImage } from "./previewDecodeCache";

const PREVIEW_CONCURRENCY = 6;
const BATCH_CONCURRENCY = 5;

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
export async function extractPreviews(items, onProgress, onTiming) {
  let done = 0;
  return runPool(items, PREVIEW_CONCURRENCY, async (item) => {
    const extractionStart = performance.now();
    let bytes = null;
    try { bytes = new Uint8Array(await item.file.arrayBuffer()); } catch { bytes = null; }
    let preview;
    try { preview = await extractRawPreview(item.file, 800, { bytes: bytes || undefined }); }
    catch { preview = placeholderPreview(); }

    if (preview?.base64 && !preview.isPlaceholder) {
      try { preview.decodedSource = await decodePreviewImage(preview.base64); } catch {}
    }
    const phash = preview?.dataUrl ? await computePHash(preview.dataUrl, preview.decodedSource) : null;
    let captureTime = null, focal = null, aperture = null, iso = null;
    let cameraInfo = null;
    let asShotWB = null;
    if (bytes) {
      try { const t = readCaptureTimeFromBytes(bytes); ({ captureTime, focal, aperture, iso } = t); } catch {}
      try { cameraInfo = readCameraMetadataFromBytes(bytes); } catch {}
      try { asShotWB = readAsShotWhiteBalance(bytes); } catch {}
    }
    const extractionMs = performance.now() - extractionStart;
    let skinStats = null;
    let skinMs = 0;
    if (preview?.base64 && !preview.isPlaceholder) {
      const skinStart = performance.now();
      try { skinStats = await analyzeSkinTone(preview.base64, preview.decodedSource); } catch { skinStats = null; }
      skinMs = performance.now() - skinStart;
    }
    onTiming?.({ extractionMs, skinMs });

    const corrupt = !preview || preview.isPlaceholder;
    const technical = {
      sharpness: preview?.sharpness ?? 0,
      exposureScore: preview?.exposureScore ?? 0.5,
      avgLuminance: preview?.histogram?.avgLuminance ?? null,
      captureTime, focal, aperture, iso,
      corrupt,
    };

    return { ...item, preview, phash, captureTime, cameraInfo, technical, asShotWB, skinStats };
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
  const trace = {
    started_at: new Date().toISOString(),
    started_ms: Date.now(),
    photo_count: withPreview.length,
    stages: {},
    bursts: [],
  };
  trace.stages.grouping = { start_ms: Date.now() };
  const valid = withPreview.filter((p) => p.preview && !p.preview.isPlaceholder);
  const groups = groupIntoScenes(valid);
  trace.stages.grouping.end_ms = Date.now();
  trace.stages.grouping.duration_ms = trace.stages.grouping.end_ms - trace.stages.grouping.start_ms;
  trace.stages.grouping.scene_count = groups.length;
  trace.stages.grouping.real_bursts = groups.filter((g) => g.files.length > 1).length;
  trace.stages.grouping.singletons = groups.filter((g) => g.files.length === 1).length;
  trace.stages.grouping.corrupt = withPreview.length - valid.length;

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

  // Ráfagas reales (misma escena, >1 foto) se analizan comparativamente (1 llamada IA
  // cada una). Las fotos sueltas (singleton — escenas de 1 foto, muy comunes en sesiones
  // con tomas espaciadas >3s) se AGRUPAN en lotes independientes: la IA juzga cada foto
  // por su mérito propio en una sola llamada, reduciendo el nº de llamadas de N (una por
  // foto) a N/INDEPENDENT_BATCH. Se preserva el groupId original de cada singleton para
  // que la cobertura/dedup sigan funcionando por escena.
  const INDEPENDENT_BATCH = 6;
  const realGroups = groups.filter((g) => g.files.length > 1);
  const singletonGroups = groups.filter((g) => g.files.length === 1);
  const bursts = realGroups.map((g) => ({ id: g.id, files: g.files, independent: false, sceneOf: null }));
  for (let i = 0; i < singletonGroups.length; i += INDEPENDENT_BATCH) {
    const batch = singletonGroups.slice(i, i + INDEPENDENT_BATCH);
    bursts.push({
      id: `ind-${i / INDEPENDENT_BATCH}`,
      files: batch.map((g) => g.files[0]),
      independent: true,
      sceneOf: new Map(batch.map((g) => [g.files[0].id, g.id])),
    });
  }
  const totalBursts = bursts.length;
  let resolved = 0;
  onProgress?.(resolved, totalBursts);

  // Instrumentación de concurrencia (solo medición; no cambia el pool ni el orden).
  let activeNow = 0;
  let maxActive = 0;
  const concurrencySamples = [];

  trace.stages.ai_analysis = { start_ms: Date.now(), bursts_total: bursts.length };
  await runPool(bursts, BATCH_CONCURRENCY, async (burst) => {
    const bStart = Date.now();
    activeNow += 1;
    if (activeNow > maxActive) maxActive = activeNow;
    concurrencySamples.push({ t_ms: Date.now() - trace.started_ms, active: activeNow });
    const concAtStart = activeNow;
    const groupIdFor = (f) => (burst.independent ? (burst.sceneOf?.get(f.id) || burst.id) : burst.id);
    const groupSizeFor = () => (burst.independent ? 1 : burst.files.length);
    let burstProvider = null, burstModel = null, burstFallback = false, burstIaCalls = 0;
    // Telemetría por llamada (solo medición; no cambia comportamiento). Las previews ya
    // fueron extraídas en Pass 1 (base64 + dimensiones en f.preview); aquí solo se
    // registran bytes/dimensiones/MIME. La conversión base64 ya ocurrió → prep_duration_ms
    // mide solo el ensamblado del payload (despreciable).
    const tPrep0 = performance.now();
    const photosPayload = [];
    const prepPhotos = [];
    for (const f of burst.files) {
      const p = f.preview || {};
      const dataUrl = p.dataUrl || "";
      const mimeMatch = /^data:([^;]+);/.exec(dataUrl);
      const b64 = p.base64 || "";
      photosPayload.push({
        id: f.id,
        preview_base64: b64,
        technical: {
          sharpness: f.technical?.sharpness ?? 0,
          exposureScore: f.technical?.exposureScore ?? 0.5,
          corrupt: !!f.technical?.corrupt,
        },
      });
      prepPhotos.push({
        id: f.id,
        mime: mimeMatch ? mimeMatch[1] : "image/jpeg",
        width: p.width || null,
        height: p.height || null,
        base64_chars: b64.length,
        image_bytes_approx: b64.length ? Math.round((b64.length * 3) / 4) : null,
      });
    }
    const prepDurationMs = Math.round(performance.now() - tPrep0);
    const invokeStartMs = Date.now();
    let invokeDurationMs = null;
    let beUploadMs = null, beRequestMs = null, beBase64Ms = null, beParseMs = null;
    let beHttpStatus = null, beTokensIn = null, beTokensOut = null, beEndpoint = null;
    try {
      const { data } = await base44.functions.invoke("rawAiSmartSelect", {
        bursts: [{
          burst_id: burst.id,
          independent: burst.independent,
          photos: photosPayload,
        }],
      });
      invokeDurationMs = Date.now() - invokeStartMs;
      const g = data?.groups?.[burst.id];
      burstProvider = g?._meta?.provider || null;
      burstModel = g?._meta?.model || null;
      burstFallback = !!g?._meta?.fallback;
      burstIaCalls = g?._meta?.ia_calls || 0;
      beUploadMs = g?._meta?.upload_ms ?? null;
      beRequestMs = g?._meta?.request_ms ?? null;
      beBase64Ms = g?._meta?.base64_convert_ms ?? null;
      beParseMs = g?._meta?.parse_ms ?? null;
      beHttpStatus = g?._meta?.http_status ?? null;
      beTokensIn = g?._meta?.tokens_in ?? null;
      beTokensOut = g?._meta?.tokens_out ?? null;
      beEndpoint = g?._meta?.endpoint ?? null;
      const rankings = Array.isArray(g?.rankings) ? g.rankings : [];
      const byId = new Map(rankings.map((r) => [String(r.id), r]));
      const category = g?.category || null;
      const reason = g?.reason || null;
      const keepIds = new Set((g?.keep_ids || []).map(String));
      burst.files.forEach((f, i) => {
        const r = byId.get(f.id);
        const status = r?.status || "REVIEW";
        const groupRank = burst.independent ? 1 : (typeof r?.rank === "number" ? r.rank : i + 1);
        const selectable = status === "SELECT" || status === "TOP_PICK";
        if (selectable) keep.add(f.id);
        meta.set(f.id, {
          groupId: groupIdFor(f),
          groupSize: groupSizeFor(),
          status,
          scores: r?.scores || null,
          rejectReasons: r?.reject_reasons || [],
          reason,
          confidence: r?.scores?.confidence ?? null,
          confidenceTier: r?.confidence_tier || "UNCERTAIN_REVIEW",
          comparedWith: burst.independent ? [] : burst.files.map((f2) => f2.id).filter((id2) => id2 !== f.id),
          category,
          groupRank,
          complementary: !burst.independent && keepIds.size > 1 && keepIds.has(f.id) && status !== "TOP_PICK",
          category_note: r?.note || "",
          analysisComplete: r?.analysis_complete ?? false,
          missingDimensions: r?.missing_dimensions || [],
          previewWarning: false,
        });
      });
    } catch {
      invokeDurationMs = Date.now() - invokeStartMs;
      burstFallback = true;
      // Fallo de IA: fallback técnico conservador POR RÁFAGA.
      const fb = technicalFallbackForGroup(burst);
      fb.forEach((m, i) => {
        const f = burst.files[i];
        if (m.status === "SELECT" || m.status === "TOP_PICK") keep.add(f.id);
        meta.set(f.id, {
          groupId: groupIdFor(f), groupSize: groupSizeFor(), status: m.status,
          scores: m.scores, rejectReasons: m.rejectReasons, reason: m.reason,
          confidence: m.confidence, confidenceTier: "UNCERTAIN_REVIEW", comparedWith: [],
          category: m.category, groupRank: burst.independent ? 1 : m.groupRank,
          complementary: m.complementary, category_note: m.category_note,
          analysisComplete: m.analysis_complete, missingDimensions: m.missing_dimensions,
          previewWarning: false,
        });
      });
    } finally {
      activeNow = Math.max(0, activeNow - 1);
      concurrencySamples.push({ t_ms: Date.now() - trace.started_ms, active: activeNow });
    }
    trace.bursts.push({
      burst_id: burst.id, independent: burst.independent, photo_count: burst.files.length,
      start_ms: bStart, end_ms: Date.now(), duration_ms: Date.now() - bStart,
      provider: burstProvider, model: burstModel, ia_calls: burstIaCalls, fallback: burstFallback,
      concurrency_at_start: concAtStart,
      prep: { duration_ms: prepDurationMs, photos: prepPhotos },
      transport: { invoke_ms: invokeDurationMs, upload_ms: beUploadMs, base64_convert_ms: beBase64Ms },
      gemini: { request_ms: beRequestMs, http_status: beHttpStatus, endpoint: beEndpoint, tokens_in: beTokensIn, tokens_out: beTokensOut },
      parse: { duration_ms: beParseMs },
    });
    resolved += 1;
    onProgress?.(resolved, totalBursts);
  }, () => {});
  trace.stages.ai_analysis.end_ms = Date.now();
  trace.stages.ai_analysis.duration_ms = trace.stages.ai_analysis.end_ms - trace.stages.ai_analysis.start_ms;
  trace.stages.ai_analysis.max_concurrency = maxActive;
  trace.stages.ai_analysis.concurrency_limit = BATCH_CONCURRENCY;
  trace.stages.ai_analysis.concurrency_samples = concurrencySamples;

  // DEDUP entre grupos: pHash detecta candidatos; la IA compara visualmente (momento,
  // expresión, composición, sujeto) y solo rebaja si es un duplicado REAL. Diferencia
  // significativa de momento/expresión/composición → NO se consideran duplicados.
  trace.stages.dedup = { start_ms: Date.now() };
  await dedupAcrossGroups(keep, meta, withPreview, trace);
  trace.stages.dedup.end_ms = Date.now();
  trace.stages.dedup.duration_ms = trace.stages.dedup.end_ms - trace.stages.dedup.start_ms;

  // ORDEN: dedup → cobertura por grupo → mínimo 1 TOP_PICK global.
  trace.stages.coverage = { start_ms: Date.now() };
  const coverage = ensureCoveragePerGroup(keep, meta, withPreview);
  trace.stages.coverage.end_ms = Date.now();
  trace.stages.coverage.duration_ms = trace.stages.coverage.end_ms - trace.stages.coverage.start_ms;
  trace.stages.coverage.promotions = coverage.promotions?.length || 0;
  trace.stages.coverage.exceptional_groups = coverage.exceptional_groups || [];

  trace.stages.fallback = { start_ms: Date.now() };
  const fallback = ensureAtLeastOneTopPick(keep, meta, withPreview);
  trace.stages.fallback.end_ms = Date.now();
  trace.stages.fallback.duration_ms = trace.stages.fallback.end_ms - trace.stages.fallback.start_ms;
  trace.stages.fallback.used = !!fallback.selection_fallback;
  trace.stages.fallback.exceptional = !!fallback.exceptional;

  trace.ended_ms = Date.now();
  trace.total_duration_ms = trace.ended_ms - trace.started_ms;
  trace.result = {
    kept: keep.size,
    statuses: Array.from(meta.values()).reduce((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {}),
    confidence_tiers: Array.from(meta.values()).reduce((acc, m) => { const t = m.confidenceTier || "UNCERTAIN_REVIEW"; acc[t] = (acc[t] || 0) + 1; return acc; }, {}),
  };
  return {
    keep, meta,
    selection_fallback: fallback.selection_fallback,
    fallback_reason: fallback.fallback_reason,
    selection_coverage_fallback: coverage.selection_coverage_fallback,
    coverage_promotions: coverage.promotions,
    trace,
  };
}

function ctxOf(m) {
  if (!m) return {};
  return { status: m.status, category: m.category, note: m.category_note || m.reason || "" };
}

// Detecta pares con pHash cercano entre grupos y pide a la IA una comparación visual.
// Solo rebaja a REVIEW si la IA confirma duplicado real; conserva ambas en caso contrario.
async function dedupAcrossGroups(keep, meta, withPreview, trace) {
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
  let dedupProvider = null, dedupModel = null, dedupFallback = false;
  const dedupAttempts = [];
  try {
    const { data } = await base44.functions.invoke("rawAiDedupCompare", { pairs });
    const decisions = data?.decisions || {};
    for (const pair of pairs) {
      const dec = decisions[pair.pair_id];
      const pm = dec?._meta;
      if (pm) {
        if (dedupProvider === null && pm.provider) dedupProvider = pm.provider;
        if (dedupModel === null && pm.model) dedupModel = pm.model;
        if (pm.fallback) dedupFallback = true;
        if (Array.isArray(pm.attempts)) dedupAttempts.push(...pm.attempts);
      }
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
  if (trace) {
    trace.stages.dedup.provider = dedupProvider;
    trace.stages.dedup.model = dedupModel;
    trace.stages.dedup.fallback = dedupFallback;
    trace.stages.dedup.attempts = dedupAttempts;
    trace.stages.dedup.pairs = pairs.length;
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
    // Todo es REJECT (o corrupt): no se fuerza un TOP_PICK técnicamente malo.
    // Se registra como caso excepcional para revisión humana.
    return { selection_fallback: false, fallback_reason: "no_selectable_all_reject", exceptional: true };
  }

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
  const exceptionalGroups = [];
  for (const [groupId, items] of byGroup) {
    const hasSelected = items.some(([, m]) => m.status === "TOP_PICK" || m.status === "SELECT");
    if (hasSelected) continue;
    const pool = items.filter(([, m]) => m.status !== "REJECT");
    if (!pool.length) {
      // Grupo sin seleccionables (todas REJECT): no se inventa ninguna selección.
      // Se registra como caso excepcional para revisión humana. Las fotos siguen REJECT.
      exceptionalGroups.push(groupId);
      continue;
    }
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
  return { selection_coverage_fallback: coverage, promotions, exceptional_groups: exceptionalGroups };
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
    asShotWB: p.asShotWB || null,
    skinStats: p.skinStats || null,
    confidenceTier: m.confidenceTier || "UNCERTAIN_REVIEW",
    comparedWith: m.comparedWith || [],
    analysisComplete: m.analysisComplete ?? false,
    missingDimensions: m.missingDimensions || [],
    previewWarning: m.previewWarning || false,
    selectionFallback: !!m.selection_fallback,
    fallbackReason: m.fallback_reason || null,
  };
}