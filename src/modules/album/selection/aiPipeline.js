// Fase 4.1 Bloques 8-9 — ORQUESTADOR del pipeline de selección IA, 100 % en el
// CLIENTE (las previews viven en IndexedDB). album-engine es un proxy sin estado
// por lote. Cada lote se persiste → el trabajo sobrevive al cierre de la app y es
// REANUDABLE (E4/E5 solo re-procesan lo que falta). E2/E3 son locales y gratuitos.
import { base44 } from "@/api/base44Client";
import { getTierPreview } from "@/modules/album/lib/previewStore";
import { sanitizeForAi } from "./sanitizer";
import { analyzeTechnical } from "@/modules/album/analysis/localTechnical";
import { buildGroups } from "@/modules/album/similarity/groupBuilder";

const E4_BATCH = 20;
const E5_MAX = 12;
const E6_MAX = 24;

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

async function withRetry(fn, attempts = 3, backoffMs = 2000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e?.cancelled) throw e;
      const msg = String(e?.response?.data?.error || e?.message || e);
      if (/consent_revoked|consent_required/.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
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

  // ---- Alias estables photo_id <-> pN (nunca se envían nombres ni rutas) ----
  const aliasOf = new Map();
  const photoOfAlias = new Map();
  photos.forEach((p, i) => {
    const a = `p${i + 1}`;
    aliasOf.set(p.id, a);
    photoOfAlias.set(a, p.id);
  });

  // ---- E2: métricas técnicas locales (gratis, recalculadas en cada ejecución) ----
  const items = [];
  const itemsById = new Map();
  for (const photo of photos) {
    checkAlive();
    const thumbData = await sanitizedThumb(projectId, photo);
    const tech = thumbData ? await analyzeTechnical(thumbData.dataUrl).catch(() => null) : null;
    const item = { photo, thumb: thumbData?.dataUrl || null, tech };
    items.push(item);
    itemsById.set(photo.id, item);
  }
  onProgress?.({ stage: "e2", done: photos.length, total: photos.length });

  // ---- E3: grupos locales (ráfagas por Δt + pHash) ----
  const groups = buildGroups(photos);
  onProgress?.({ stage: "e3", done: groups.length, total: groups.length });

  // ---- E4: triaje por lotes (remoto, persistido por lote → reanudable) ----
  // TRAZABILIDAD REAL: total = fotos elegibles del catálogo; fallidas = sin preview
  // local o sin respuesta del proveedor (identificadas y reintentables). Una foto
  // que la IA no devuelve NUNCA se rellena con valores neutros: queda pendiente y
  // se reintenta en la siguiente ejecución.
  const eligible = photos.length;
  const analyzedPhotoIds = new Set(resume.analyses.map((a) => a.photo_id));
  const failedNoPreview = items.filter((it) => !it.thumb).map((it) => it.photo.id);
  const failedNoResponse = new Set();
  const batches = [];
  const pending = items.filter((it) => !analyzedPhotoIds.has(it.photo.id) && it.thumb);
  for (let i = 0; i < pending.length; i += E4_BATCH) batches.push(pending.slice(i, i + E4_BATCH));
  const analyses = [...resume.analyses];
  for (const batch of batches) {
    checkAlive();
    const out = await withRetry(() =>
      callEngine("e4-triage", {
        event_type: eventType,
        batch: batch.map((it) => ({
          alias: aliasOf.get(it.photo.id),
          thumb: it.thumb,
          orientation: it.photo.orientation,
          capture_time: it.photo.capture_time,
          local_tech: it.tech,
        })),
      })
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
    analyses.push(...records);
    records.forEach((r) => analyzedPhotoIds.add(r.photo_id));
    (out.missing || []).forEach((a) => {
      const pid = photoOfAlias.get(a);
      if (pid && !analyzedPhotoIds.has(pid)) failedNoResponse.add(pid);
    });
    onProgress?.({ stage: "e4", done: Math.min(analyses.length, eligible), total: eligible });
  }
  const e4ByPhoto = new Map(analyses.map((a) => [a.photo_id, a]));

  // ---- E5: decisión por grupo (remoto; sub-lotes de E5_MAX) ----
  const resumeGroups = new Map(resume.groups.map((g) => [g.group_index, g]));
  const groupRecords = [];
  const promotedByGroup = new Map();
  const e5Groups = groups.filter((g) => g.photo_ids.length >= 2);
  let e5Done = 0;
  for (const g of groups) {
    checkAlive();
    const prev = resumeGroups.get(g.group_index);
    // La agrupación puede cambiar entre ejecuciones (p. ej. tras corregir el
    // encadenado de grupos): un registro previo solo se reutiliza si sus fotos
    // coinciden EXACTAMENTE con el grupo actual; si no, se reprocesa entero.
    const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => b.includes(x));
    if (prev?.e5 && prev?.promoted_photo_id && sameIds(prev.photo_ids, g.photo_ids)) {
      promotedByGroup.set(g.group_index, prev.promoted_photo_id);
      groupRecords.push(prev);
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
      groupRecords.push(rec);
      await persistGroup(rec, prev).catch(() => {});
      continue;
    }
    let promoted = null;
    let summary = "";
    let provider = "";
    let model = "";
    const perPhotoAll = [];
    for (let i = 0; i < members.length; i += E5_MAX) {
      checkAlive();
      const sub = members.slice(i, i + E5_MAX);
      const out = await withRetry(() =>
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
        })
      );
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
    promotedByGroup.set(g.group_index, promoted);
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
    groupRecords.push(rec);
    await persistGroup(rec, prev).catch(() => {});
    e5Done++;
    onProgress?.({ stage: "e5", done: e5Done, total: e5Groups.length });
  }

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
  if (resume.moments?.length) {
    moments = resume.moments;
  } else if (capped.length >= 3) {
    const out = await withRetry(() =>
      callEngine("e6-moments", {
        event_type: eventType,
        representatives: capped.map((c) => ({ alias: c.alias, thumb: c.thumb, group_kind: c.group_kind })),
      })
    );
    providerUsed = out.provider;
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
  }
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
  const out = await withRetry(() =>
    callEngine("e7-assembly", { event_type: eventType, album_target: target, descriptors, forced, blocked })
  );
  providerUsed = providerUsed || out.provider;
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
  return {
    selection,
    funnel_report: { ...(out.funnel_report || {}), coverage: out.coverage || "" },
    coverage: out.coverage || "",
    moments,
    analyses,
    groups: groupRecords,
    providerUsed,
    funnelStats,
  };
}