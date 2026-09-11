// Fase 4.1 Bloques 8-9 — ORQUESTADOR del pipeline de selección IA, 100 % en el
// CLIENTE (las previews viven en IndexedDB). album-engine es un proxy sin estado
// por lote. Cada lote se persiste → el trabajo sobrevive al cierre de la app y es
// REANUDABLE (E4/E5 solo re-procesan lo que falta). E2/E3 son locales y gratuitos,
// salvo las fronteras AMBIGUAS de E3 que resuelve la visión en lotes pequeños.
import { base44 } from "@/api/base44Client";
import { getTierPreview } from "@/modules/album/lib/previewStore";
import { sanitizeForAi } from "./sanitizer";
import { analyzeTechnical } from "@/modules/album/analysis/localTechnical";
import { buildGroups } from "@/modules/album/similarity/groupBuilder";
import { computeFrameSignal } from "@/modules/album/similarity/frameSignal";

const E4_BATCH = 20;
const E5_MAX = 12;
const E6_MAX = 24;
// FASE 2 — Concurrencia controlada de E4/E5. Las llamadas remotas independientes
// (lotes E4, ráfagas E5) se ejecutan con hasta MAX_CONCURRENCY llamadas simultáneas
// al proveedor activo de Selección IA. Si el proveedor responde 429/503 (rate limit),
// el límite baja automáticamente a 2 (no se sube a 4+ sin autorización). Cada llamada
// recibe EXACTAMENTE los mismos datos, prompt, proveedor y modelo que en secuencia:
// la única diferencia es que varias ráfagas/lotes se procesan a la vez. Resultados y
// persistencia por lote/grupo se conservan idénticos.
const MAX_CONCURRENCY = 3;
const RATE_LIMIT_CONCURRENCY = 2;

// CONTROL DE SIMILITUD en la selección final: la IA puede aceptar varias fotos
// casi idénticas del mismo grupo de ráfaga/secuencia. Tope determinista por
// grupo (ráfaga: 1 foto; secuencia: 2): se conserva la mejor (la promovida; en
// su defecto, la de mejor rol). Se aplica ANTES de los overrides del fotógrafo,
// que siempre prevalecen. Reutiliza los grupos E3/E5 ya calculados.
const ROLE_RANK = { hero: 0, key: 1, support: 2, detail: 3 };
const SIMILARITY_CAP = { burst: 1, sequence: 2 };
function enforceSimilarityCaps(selection, groups, promotedByGroup) {
  const groupOf = new Map();
  for (const g of groups) for (const id of g.photo_ids || []) groupOf.set(id, g);
  const byGroup = new Map();
  selection.forEach((s, i) => {
    const g = groupOf.get(s.photo_id);
    if (!g || (g.photo_ids || []).length < 2) return;
    if (!byGroup.has(g.group_index)) byGroup.set(g.group_index, []);
    byGroup.get(g.group_index).push({ s, i });
  });
  const drop = new Set();
  for (const [gIdx, items] of byGroup) {
    const cap = SIMILARITY_CAP[groupOf.get(items[0].s.photo_id)?.kind] || 1;
    if (items.length <= cap) continue;
    const promoted = promotedByGroup.get(gIdx);
    const ranked = [...items].sort((a, b) => {
      const pa = a.s.photo_id === promoted ? 0 : 1;
      const pb = b.s.photo_id === promoted ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ra = ROLE_RANK[a.s.role] ?? 9;
      const rb = ROLE_RANK[b.s.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    });
    ranked.slice(cap).forEach((x) => drop.add(x.s.photo_id));
  }
  return selection.filter((s) => !drop.has(s.photo_id));
}

export class PipelineCancelled extends Error {
  constructor() {
    super("cancelled");
    this.cancelled = true;
  }
}

async function callEngine(action, payload) {
  const res = await base44.functions.invoke("album-engine", { action, consent: true, ...payload });
  return res.data;
}

async function withRetry(fn, attempts = 3, backoffMs = 2000, onRetry) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e?.cancelled) throw e;
      const msg = String(e?.response?.data?.error || e?.message || e);
      if (/consent_revoked|consent_required/.test(msg)) throw e;
      if (i < attempts - 1 && typeof onRetry === "function") onRetry(e);
      await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
}

// Métricas por etapa (FASE 2): tiempo total, llamadas, fotos enviadas, errores,
// retries, concurrencia máxima utilizada y trazas por llamada (inicio/fin/duración,
// grupo/lote, proveedor, modelo). No altera el resultado; solo observa.
function makeMetrics() {
  return {
    startMs: 0,
    endMs: 0,
    totalMs: 0,
    calls: 0,
    photosSent: 0,
    errors: 0,
    retries: 0,
    maxConcurrency: 0,
    finalConcurrency: MAX_CONCURRENCY,
    rateLimited: false,
    perCall: [],
  };
}

// Ejecuta `worker(item, index, setLimit)` sobre `items` con a lo sumo `concurrency`
// llamadas simultáneas. Preserva el orden (results[index]) sin condiciones de carrera:
// cada worker escribe solo su slot. setLimit(newLimit) permite bajar el límite en caliente
// si un proveedor responde 429/503 (rate limit): los nuevos acquire() esperan a que
// active drene por debajo del nuevo límite. isCancelled() detiene el lanzamiento de
// nuevas tareas (las en curso terminan o fallan por cancelación del signal).
async function runWithConcurrency(items, concurrency, worker, isCancelled) {
  const results = new Array(items.length);
  let next = 0;
  let active = 0;
  let maxActive = 0;
  let limit = concurrency;
  const waiters = [];
  async function acquire() {
    while (active >= limit) {
      await new Promise((resolve) => waiters.push(resolve));
    }
    active++;
    if (active > maxActive) maxActive = active;
  }
  function release() {
    active--;
    const w = waiters.shift();
    if (w) w();
  }
  async function run() {
    while (next < items.length) {
      if (isCancelled && isCancelled()) break;
      const idx = next++;
      await acquire();
      if (isCancelled && isCancelled()) {
        release();
        break;
      }
      try {
        results[idx] = await worker(items[idx], idx, (newLimit) => {
          if (Number.isFinite(newLimit) && newLimit < limit) limit = newLimit;
        });
      } catch (e) {
        results[idx] = { __error: e };
      } finally {
        release();
      }
    }
  }
  const runners = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) runners.push(run());
  await Promise.all(runners);
  return { results, maxActive, finalConcurrency: limit };
}

// Detecta 429/503 (rate limit del proveedor) en un error de llamada para bajar
// la concurrencia automáticamente. Devuelve true si el error es de rate limit.
function isRateLimitError(e) {
  const status = e?.response?.status || e?.httpStatus || e?.response?.data?.status;
  if (status === 429 || status === 503) return true;
  const msg = String(e?.response?.data?.error || e?.message || e || "");
  return /429|503|rate.?limit|too many requests|overloaded/i.test(msg);
}

async function sanitizedThumb(projectId, photo) {
  const src =
    (await getTierPreview(projectId, photo.id, "preview")) ||
    (await getTierPreview(projectId, photo.id, "thumb"));
  if (!src) return null;
  try {
    return await sanitizeForAi(src);
  } catch {
    return null;
  }
}

function pickBySharpness(members) {
  if (!members.length) return null;
  const sorted = [...members].sort((a, b) => (b.tech?.sharpness ?? -1) - (a.tech?.sharpness ?? -1));
  return sorted[0];
}

async function persistGroup(rec, prev) {
  const patch = {
    project_id: rec.project_id,
    selection_id: rec.selection_id,
    group_index: rec.group_index,
    kind: rec.kind,
    photo_ids: rec.photo_ids,
    promoted_photo_id: rec.promoted_photo_id,
    e5: rec.e5,
    provider: rec.provider,
  };
  if (prev?.id) return base44.entities.AlbumPhotoGroup.update(prev.id, patch);
  return base44.entities.AlbumPhotoGroup.create(patch);
}

export async function runAiSelectionPipeline({ project, photos, resume = {}, onProgress, signal }) {
  const projectId = project.id;
  const eventType = project.event_type || "event";
  const checkAlive = () => {
    if (signal?.aborted) throw new PipelineCancelled();
  };

  // TRAZA COMPLETA: registra cada etapa del pipeline con marcas de tiempo,
  // proveedor, modelo y conteos. Se persiste en el job (stats.trace) para
  // auditar toda la ejecución desde el botón hasta el final.
  const trace = {
    started_at: new Date().toISOString(),
    started_ms: Date.now(),
    project_id: projectId,
    photo_count: photos.length,
    stages: {},
    events: [],
  };

  // ---- Alias estables photo_id <-> pN (nunca se envían nombres ni rutas) ----
  const aliasOf = new Map();
  const photoOfAlias = new Map();
  photos.forEach((p, i) => {
    const a = `p${i + 1}`;
    aliasOf.set(p.id, a);
    photoOfAlias.set(a, p.id);
  });

  // ---- E2: métricas técnicas locales (gratis, recalculadas en cada ejecución) ----
  trace.stages.e2 = { start_ms: Date.now() };
  const items = [];
  const itemsById = new Map();
  for (const photo of photos) {
    checkAlive();
    const thumbData = await sanitizedThumb(projectId, photo);
    const tech = thumbData ? await analyzeTechnical(thumbData.dataUrl).catch(() => null) : null;
    // Señal visual 16×16 (barata, canvas): alimenta la agrupación de ráfagas E3.
    const signal = thumbData ? await computeFrameSignal(thumbData.dataUrl).catch(() => null) : null;
    const item = { photo, thumb: thumbData?.dataUrl || null, tech, signal };
    items.push(item);
    itemsById.set(photo.id, item);
  }
  trace.stages.e2.end_ms = Date.now();
  trace.stages.e2.duration_ms = trace.stages.e2.end_ms - trace.stages.e2.start_ms;
  trace.stages.e2.photo_count = photos.length;
  trace.stages.e2.with_preview = items.filter((it) => it.thumb).length;
  onProgress?.({ stage: "e2", done: photos.length, total: photos.length });

  // ---- E3: grupos por CONTINUIDAD de momento ----
  // Local (gratis): Δt como señal + pHash (escena) + frameSignal (encuadre y
  // sujetos). La visión SOLO resuelve fronteras ambiguas — pares consecutivos con
  // misma escena y cambio moderado (posible giro de cabeza/pose/expresión/sujeto
  // que entra o sale) — en lotes de 12 pares. El tiempo NUNCA une por sí solo y
  // no hay tope de tamaño: las cadenas se rompen por continuidad (deriva del
  // ancla), no por un límite arbitrario. Los ids y el orden temporal no cambian.
  trace.stages.e3 = { start_ms: Date.now(), vision_calls: [] };
  const signals = new Map(items.filter((it) => it.signal).map((it) => [it.photo.id, it.signal]));
  const groups = await buildGroups({
    photos,
    signals,
    thumbOf: (id) => itemsById.get(id)?.thumb || null,
    resolveContinuity: async (pairs) => {
      const decisions = [];
      const PAIR_BATCH = 12; // tope de imágenes del motor: 24 → 12 pares por lote
      for (let i = 0; i < pairs.length; i += PAIR_BATCH) {
        const batch = pairs.slice(i, i + PAIR_BATCH);
        let out = null;
        const callStart = Date.now();
        try {
          out = await withRetry(() =>
            callEngine("e3-continuity", {
              event_type: eventType,
              pairs: batch.map((p) => ({ a: p.prevThumb, b: p.curThumb })),
            })
          );
        } catch {
          out = null; // sin visión disponible: unión conservadora (no se parte la ráfaga)
        }
        trace.stages.e3.vision_calls.push({
          start_ms: callStart, end_ms: Date.now(), duration_ms: Date.now() - callStart,
          pairs: batch.length, provider: out?.provider || null, model: out?.model || null,
        });
        batch.forEach((p, j) => {
          const d = (out?.decisions || []).find((x) => Number(x.pair) === j);
          decisions.push(d ? d.same_moment !== false : true);
        });
      }
      return decisions;
    },
  });
  trace.stages.e3.end_ms = Date.now();
  trace.stages.e3.duration_ms = trace.stages.e3.end_ms - trace.stages.e3.start_ms;
  trace.stages.e3.group_count = groups.length;
  trace.stages.e3.kinds = groups.reduce((acc, g) => { acc[g.kind] = (acc[g.kind] || 0) + 1; return acc; }, {});
  onProgress?.({ stage: "e3", done: groups.length, total: groups.length });

  // ---- E4: triaje por lotes (remoto, persistido por lote → reanudable) ----
  // FASE 2: los lotes independientes se ejecutan con concurrencia controlada
  // (MAX_CONCURRENCY=3). Cada lote recibe EXACTAMENTE los mismos datos, prompt,
  // proveedor y modelo que en secuencia. Cada lote persiste sus análisis en cuanto
  // termina (bulkCreate) → no hay pérdida si otro lote paralelo falla. El merge
  // final se hace en orden de lote (results[idx]) para conservar el determinismo.
  // TRAZABILIDAD REAL: total = fotos elegibles del catálogo; fallidas = sin preview
  // local o sin respuesta del proveedor (identificadas y reintentables). Una foto
  // que la IA no devuelve NUNCA se rellena con valores neutros: queda pendiente y
  // se reintenta en la siguiente ejecución.
  const e4Metrics = makeMetrics();
  e4Metrics.startMs = Date.now();
  const eligible = photos.length;
  const analyzedPhotoIds = new Set(resume.analyses.map((a) => a.photo_id));
  const failedNoPreview = items.filter((it) => !it.thumb).map((it) => it.photo.id);
  const failedNoResponse = new Set();
  const batches = [];
  const pending = items.filter((it) => !analyzedPhotoIds.has(it.photo.id) && it.thumb);
  for (let i = 0; i < pending.length; i += E4_BATCH) batches.push(pending.slice(i, i + E4_BATCH));
  const analyses = [...resume.analyses];
  let e4ProgressCount = analyses.length;
  const { results: e4Results, maxActive: e4MaxActive, finalConcurrency: e4FinalConc } = await runWithConcurrency(
    batches,
    MAX_CONCURRENCY,
    async (batch, batchIdx, setLimit) => {
      checkAlive();
      const c0 = Date.now();
      const photosInBatch = batch.length;
      const onRetry = (e) => {
        e4Metrics.retries++;
        if (isRateLimitError(e)) {
          setLimit(RATE_LIMIT_CONCURRENCY);
          e4Metrics.rateLimited = true;
        }
      };
      try {
        const out = await withRetry(
          () =>
            callEngine("e4-triage", {
              event_type: eventType,
              batch: batch.map((it) => ({
                alias: aliasOf.get(it.photo.id),
                thumb: it.thumb,
                orientation: it.photo.orientation,
                capture_time: it.photo.capture_time,
                local_tech: it.tech,
              })),
            }),
          3,
          2000,
          onRetry
        );
        const records = (out.analyses || [])
          .filter((a) => photoOfAlias.has(a.alias))
          .map((a) => ({
            project_id: projectId,
            photo_id: photoOfAlias.get(a.alias),
            selection_id: resume.selectionId || null,
            stage: "e4",
            dims: a.dims || null,
            confidence: a.confidence ?? 0,
            reasons: a.reasons || "",
            local_tech: itemsById.get(photoOfAlias.get(a.alias))?.tech || null,
            provider: out.provider,
            model: out.model,
          }));
        if (records.length) await base44.entities.AlbumPhotoAnalysis.bulkCreate(records);
        const missingPids = (out.missing || []).map((a) => photoOfAlias.get(a)).filter(Boolean);
        e4Metrics.calls++;
        e4Metrics.photosSent += photosInBatch;
        e4Metrics.perCall.push({
          batch: batchIdx,
          start: c0,
          end: Date.now(),
          durationMs: Date.now() - c0,
          provider: out.provider,
          model: out.model,
          photos: photosInBatch,
        });
        e4ProgressCount += records.length;
        onProgress?.({ stage: "e4", done: Math.min(e4ProgressCount, eligible), total: eligible });
        return { ok: true, records, missingPids };
      } catch (e) {
        e4Metrics.errors++;
        e4Metrics.perCall.push({
          batch: batchIdx,
          start: c0,
          end: Date.now(),
          durationMs: Date.now() - c0,
          error: String(e?.message || e),
        });
        return { ok: false, error: e };
      }
    },
    () => signal?.aborted
  );
  e4Metrics.maxConcurrency = e4MaxActive;
  e4Metrics.finalConcurrency = e4FinalConc;
  e4Metrics.endMs = Date.now();
  e4Metrics.totalMs = e4Metrics.endMs - e4Metrics.startMs;
  trace.stages.e4 = {
    duration_ms: e4Metrics.totalMs, calls: e4Metrics.calls, photos_sent: e4Metrics.photosSent,
    errors: e4Metrics.errors, retries: e4Metrics.retries, max_concurrency: e4Metrics.maxConcurrency,
    final_concurrency: e4Metrics.finalConcurrency, rate_limited: e4Metrics.rateLimited,
    per_call: e4Metrics.perCall,
  };
  // Merge en orden de lote: conserva el determinismo de `analyses` y evita
  // condiciones de carrera sobre el estado compartido (cada worker escribió su slot).
  let e4FirstError = null;
  for (const r of e4Results) {
    if (!r) continue;
    if (r.ok) {
      analyses.push(...r.records);
      r.records.forEach((rec) => analyzedPhotoIds.add(rec.photo_id));
      r.missingPids.forEach((pid) => {
        if (!analyzedPhotoIds.has(pid)) failedNoResponse.add(pid);
      });
    } else if (!e4FirstError) {
      e4FirstError = r.error;
    }
  }
  if (e4FirstError) throw e4FirstError;
  const e4ByPhoto = new Map(analyses.map((a) => [a.photo_id, a]));

  // ---- E5: decisión por grupo (remoto; sub-lotes de E5_MAX) ----
  // FASE 2: las ráfagas independientes se ejecutan con concurrencia controlada
  // (MAX_CONCURRENCY=3). Cada ráfaga recibe EXACTAMENTE las mismas fotos,
  // local_tech, e4_summary, prompt, proveedor y modelo que en secuencia. Los
  // sub-lotes dentro de una misma ráfaga siguen siendo secuenciales (una ráfaga
  // >12 fotos se divide en sub-lotes E5_MAX, igual que antes). Cada ráfaga
  // persiste su grupo en cuanto termina (persistGroup) → no hay pérdida si otra
  // ráfaga paralela falla. El merge final se hace en orden de grupo (results[idx]).
  const e5Metrics = makeMetrics();
  e5Metrics.startMs = Date.now();
  const resumeGroups = new Map(resume.groups.map((g) => [g.group_index, g]));
  const groupRecords = new Array(groups.length);
  const promotedByGroup = new Map();
  const e5Groups = groups.filter((g) => g.photo_ids.length >= 2);
  let e5Done = 0;
  // Primera pasada (secuencial, rápida): clasificar reusados / locales / remotos.
  // Los reusados y locales no necesitan llamada remota; se resuelven igual que
  // antes. Solo las ráfagas remotas se paralelizan.
  const remoteTasks = [];
  for (let idx = 0; idx < groups.length; idx++) {
    const g = groups[idx];
    const prev = resumeGroups.get(g.group_index);
    // La agrupación puede cambiar entre ejecuciones (p. ej. tras corregir el
    // encadenado de grupos): un registro previo solo se reutiliza si sus fotos
    // coinciden EXACTAMENTE con el grupo actual; si no, se reprocesa entero.
    const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => b.includes(x));
    if (prev?.e5 && prev?.promoted_photo_id && sameIds(prev.photo_ids, g.photo_ids)) {
      promotedByGroup.set(g.group_index, prev.promoted_photo_id);
      groupRecords[idx] = prev;
      if (g.photo_ids.length >= 2) e5Done++;
      continue;
    }
    const members = g.photo_ids.map((id) => itemsById.get(id)).filter(Boolean);
    if (g.photo_ids.length < 2 || members.length < 2 || members.some((m) => !m.thumb)) {
      // Foto aislada (o sin preview local): decisión LOCAL, sin llamada remota.
      const rep = pickBySharpness(members) || members[0] || null;
      promotedByGroup.set(g.group_index, rep?.photo.id || null);
      const rec = {
        id: prev?.id,
        project_id: projectId,
        selection_id: resume.selectionId || null,
        group_index: g.group_index,
        kind: g.kind,
        photo_ids: g.photo_ids,
        promoted_photo_id: rep?.photo.id || null,
        e5: null,
        provider: "local",
      };
      groupRecords[idx] = rec;
      await persistGroup(rec, prev).catch(() => {});
      continue;
    }
    remoteTasks.push({ g, prev, members, idx });
  }
  let e5ProgressDone = e5Done;
  const { results: e5Results, maxActive: e5MaxActive, finalConcurrency: e5FinalConc } = await runWithConcurrency(
    remoteTasks,
    MAX_CONCURRENCY,
    async (task, _i, setLimit) => {
      checkAlive();
      const { g, prev, members, idx } = task;
      const c0 = Date.now();
      let promoted = null;
      let summary = "";
      let provider = "";
      let model = "";
      const perPhotoAll = [];
      const onRetry = (e) => {
        e5Metrics.retries++;
        if (isRateLimitError(e)) {
          setLimit(RATE_LIMIT_CONCURRENCY);
          e5Metrics.rateLimited = true;
        }
      };
      try {
        for (let i = 0; i < members.length; i += E5_MAX) {
          checkAlive();
          const sub = members.slice(i, i + E5_MAX);
          const out = await withRetry(
            () =>
              callEngine("e5-group", {
                event_type: eventType,
                group_kind: g.kind,
                group: sub.map((m) => ({
                  alias: aliasOf.get(m.photo.id),
                  thumb: m.thumb,
                  capture_time: m.photo.capture_time,
                  local_tech: m.tech,
                  e4_summary: e4ByPhoto.get(m.photo.id)?.dims || null,
                })),
              }),
            3,
            2000,
            onRetry
          );
          e5Metrics.calls++;
          e5Metrics.photosSent += sub.length;
          e5Metrics.perCall.push({
            group: g.group_index,
            start: c0,
            end: Date.now(),
            durationMs: Date.now() - c0,
            provider: out.provider,
            model: out.model,
            photos: sub.length,
          });
          if (!promoted) {
            promoted = photoOfAlias.get(out.promoted) || sub[0].photo.id;
            summary = out.group_summary;
            provider = out.provider;
            model = out.model;
          }
          (out.per_photo || []).forEach((pp) => {
            if (photoOfAlias.has(pp.alias)) perPhotoAll.push({ ...pp, photo_id: photoOfAlias.get(pp.alias) });
          });
        }
        // La promovida es la MEJOR de TODO el grupo (no solo del primer sub-lote):
        // gana la foto con mejor group_rank entre todas las respuestas recibidas.
        const ranked = perPhotoAll.filter((pp) => Number.isFinite(pp.group_rank)).sort((a, b) => a.group_rank - b.group_rank)[0];
        if (ranked) promoted = ranked.photo_id;
        const rec = {
          id: prev?.id,
          project_id: projectId,
          selection_id: resume.selectionId || null,
          group_index: g.group_index,
          kind: g.kind,
          photo_ids: g.photo_ids,
          promoted_photo_id: promoted,
          e5: { promoted: aliasOf.get(promoted), per_photo: perPhotoAll, group_summary: summary },
          provider,
          model,
        };
        await persistGroup(rec, prev).catch(() => {});
        e5ProgressDone++;
        onProgress?.({ stage: "e5", done: e5ProgressDone, total: e5Groups.length });
        return { ok: true, idx, rec, promoted };
      } catch (e) {
        e5Metrics.errors++;
        e5Metrics.perCall.push({
          group: g.group_index,
          start: c0,
          end: Date.now(),
          durationMs: Date.now() - c0,
          error: String(e?.message || e),
        });
        return { ok: false, idx, error: e };
      }
    },
    () => signal?.aborted
  );
  e5Metrics.maxConcurrency = e5MaxActive;
  e5Metrics.finalConcurrency = e5FinalConc;
  e5Metrics.endMs = Date.now();
  e5Metrics.totalMs = e5Metrics.endMs - e5Metrics.startMs;
  trace.stages.e5 = {
    duration_ms: e5Metrics.totalMs, calls: e5Metrics.calls, photos_sent: e5Metrics.photosSent,
    errors: e5Metrics.errors, retries: e5Metrics.retries, max_concurrency: e5Metrics.maxConcurrency,
    final_concurrency: e5Metrics.finalConcurrency, rate_limited: e5Metrics.rateLimited,
    per_call: e5Metrics.perCall,
  };
  // Merge en orden de grupo: conserva el determinismo de groupRecords y
  // promotedByGroup, y evita condiciones de carrera sobre el estado compartido.
  let e5FirstError = null;
  for (const r of e5Results) {
    if (!r) continue;
    if (r.ok) {
      groupRecords[r.idx] = r.rec;
      promotedByGroup.set(r.rec.group_index, r.promoted);
    } else if (!e5FirstError) {
      e5FirstError = r.error;
    }
  }
  if (e5FirstError) throw e5FirstError;

  // ---- E6: momentos narrativos (representativas, máx E6_MAX) ----
  const promotedItems = [];
  for (const g of groups) {
    const pid = promotedByGroup.get(g.group_index);
    const it = pid ? itemsById.get(pid) : null;
    if (it?.thumb) promotedItems.push({ alias: aliasOf.get(pid), photoId: pid, thumb: it.thumb, group_kind: g.kind });
  }
  const capped = promotedItems.slice(0, E6_MAX);
  let moments = [];
  let providerUsed = "";
  trace.stages.e6 = { start_ms: Date.now() };
  if (resume.moments?.length) {
    moments = resume.moments;
    trace.stages.e6.resumed = true;
  } else if (capped.length >= 3) {
    const out = await withRetry(() =>
      callEngine("e6-moments", {
        event_type: eventType,
        representatives: capped.map((c) => ({ alias: c.alias, thumb: c.thumb, group_kind: c.group_kind })),
      })
    );
    providerUsed = out.provider;
    trace.stages.e6.provider = out.provider;
    trace.stages.e6.model = out.model;
    trace.stages.e6.representatives = capped.length;
    moments = (out.moments || []).map((m, i) => ({ ...m, order_index: m.order || i + 1 }));
    const recs = moments.map((m) => ({
      project_id: projectId,
      selection_id: resume.selectionId || null,
      order_index: m.order_index,
      name: String(m.name || "Momento"),
      archetype: String(m.archetype || ""),
      photo_ids: (m.aliases || []).map((a) => photoOfAlias.get(a)).filter(Boolean),
      summary: String(m.summary || ""),
      provider: out.provider,
    }));
    if (recs.length) await base44.entities.AlbumMoment.bulkCreate(recs).catch(() => {});
  } else {
    moments = [{ name: "Reportaje", archetype: "general", order_index: 1, summary: "", aliases: capped.map((c) => c.alias), photo_ids: capped.map((c) => c.photoId) }];
    trace.stages.e6.skipped = true;
  }
  trace.stages.e6.end_ms = Date.now();
  trace.stages.e6.duration_ms = trace.stages.e6.end_ms - trace.stages.e6.start_ms;
  trace.stages.e6.moment_count = moments.length;
  onProgress?.({ stage: "e6", done: moments.length, total: moments.length });

  // ---- E7: selección final (SOLO TEXTO; 1 llamada) ----
  // JERARQUÍA DEL FOTÓGRAFO: forced/blocked se imponen SIEMPRE a la IA.
  const forced = photos.filter((p) => p.ai_override === "forced").map((p) => aliasOf.get(p.id));
  const blocked = photos.filter((p) => p.ai_override === "blocked").map((p) => aliasOf.get(p.id));
  const momentOfPhoto = new Map();
  for (const m of moments) {
    const ids = m.photo_ids || (m.aliases || []).map((a) => photoOfAlias.get(a)).filter(Boolean);
    ids.forEach((id) => momentOfPhoto.set(id, m.name));
  }
  // E7 recibe descriptores de TODAS las fotos analizadas — no solo la promovida de
  // cada grupo. La selección final puede elegir cualquier foto del catálogo; las
  // promovidas van marcadas como las mejores de su grupo/ráfaga. Este es el punto
  // donde el embudo anterior perdía el lote (1 descriptor por grupo → selección
  // de 1 foto aunque el catálogo tenga 79).
  const groupOfPhoto = new Map();
  for (const g of groups) for (const id of g.photo_ids || []) groupOfPhoto.set(id, g);
  const descriptors = items
    .filter((it) => e4ByPhoto.has(it.photo.id))
    .map((it) => {
      const an = e4ByPhoto.get(it.photo.id);
      const g = groupOfPhoto.get(it.photo.id);
      const isPromoted = promotedByGroup.get(g?.group_index) === it.photo.id;
      return {
        alias: aliasOf.get(it.photo.id),
        phrase: `${g ? `grupo ${g.group_index} (${g.kind})` : "single"}${isPromoted ? "; PROMOTED (mejor de su grupo)" : ""}; E4 ${JSON.stringify(an?.dims || {})}; conf ${an?.confidence ?? "?"}; ${an?.reasons || ""}`,
      };
    });
  // REGLA ANTI-DATOS INSUFICIENTES: nunca se genera una selección final cuando el
  // embudo ha perdido el catálogo (p. ej. 1 descriptor de 79 fotos).
  if (descriptors.length < Math.floor(eligible * 0.5)) {
    throw new Error(
      `Análisis incompleto: ${descriptors.length} descriptores válidos de ${eligible} fotos del catálogo (analizadas ${e4ByPhoto.size}). No se genera una selección con datos insuficientes: pulsa «Re-ejecutar selección» para reintentar las fotos pendientes.`
    );
  }
  const target = {
    spreads: project.spread_count_target || 20,
    per_spread: project.max_photos_per_spread || 3,
    total: (project.spread_count_target || 20) * (project.max_photos_per_spread || 3),
  };
  trace.stages.e7 = { start_ms: Date.now(), descriptor_count: descriptors.length, forced: forced.length, blocked: blocked.length };
  const out = await withRetry(() =>
    callEngine("e7-assembly", { event_type: eventType, album_target: target, descriptors, forced, blocked })
  );
  providerUsed = providerUsed || out.provider;
  trace.stages.e7.end_ms = Date.now();
  trace.stages.e7.duration_ms = trace.stages.e7.end_ms - trace.stages.e7.start_ms;
  trace.stages.e7.provider = out.provider;
  trace.stages.e7.model = out.model;
  trace.stages.e7.selected_count = (out.selection || []).length;
  let selection = (out.selection || [])
    .filter((s) => photoOfAlias.has(s.alias))
    .map((s) => ({
      photo_id: photoOfAlias.get(s.alias),
      role: s.role || "support",
      moment: momentOfPhoto.get(photoOfAlias.get(s.alias)) || s.moment || "",
      category: s.category || "",
      reasons: s.reasons || "",
      tech_exception: !!s.tech_exception,
    }));
  // CONTROL DE SIMILITUD: tope determinista por grupo de ráfaga/secuencia (ver
  // enforceSimilarityCaps). Se ejecuta antes de los overrides del fotógrafo.
  selection = enforceSimilarityCaps(selection, groups, promotedByGroup);
  // Defensa de la jerarquía en cliente: forced dentro, blocked fuera (siempre).
  const selIds = new Set(selection.map((s) => s.photo_id));
  for (const p of photos) {
    if (p.ai_override === "forced" && !selIds.has(p.id)) {
      selection.push({
        photo_id: p.id,
        role: "support",
        moment: momentOfPhoto.get(p.id) || "",
        category: "override",
        reasons: "Incluida por decisión del fotógrafo (override forzado).",
        tech_exception: false,
      });
    } else if (p.ai_override === "blocked") {
      selection = selection.filter((s) => s.photo_id !== p.id);
    }
  }
  onProgress?.({ stage: "e7", done: 1, total: 1 });

  // TRAZABILIDAD FINAL: cifras reales del embudo, persistidas en el job para que la
  // pantalla muestre siempre "X / N analizadas" con las fallidas identificadas.
  const funnelStats = {
    eligible,
    previews_ok: eligible - failedNoPreview.length,
    analyzed: e4ByPhoto.size,
    descriptors: descriptors.length,
    failed_no_preview: failedNoPreview.length,
    failed_no_response: failedNoResponse.size,
  };
  trace.ended_ms = Date.now();
  trace.total_duration_ms = trace.ended_ms - trace.started_ms;
  trace.provider_used = providerUsed;
  return {
    selection,
    funnel_report: { ...(out.funnel_report || {}), coverage: out.coverage || "" },
    coverage: out.coverage || "",
    moments,
    analyses,
    groups: groupRecords,
    providerUsed,
    funnelStats,
    metrics: { e4: e4Metrics, e5: e5Metrics },
    trace,
  };
}