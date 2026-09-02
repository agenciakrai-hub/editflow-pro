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
  const analyzedPhotoIds = new Set(resume.analyses.map((a) => a.photo_id));
  const e4Total = items.filter((it) => it.thumb).length;
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
    onProgress?.({ stage: "e4", done: Math.min(analyzedPhotoIds.size, e4Total), total: e4Total });
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
    if (prev?.e5 && prev?.promoted_photo_id) {
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
  const descriptors = promotedItems.map((pi) => {
    const an = e4ByPhoto.get(pi.photoId);
    const g = groups.find((gg) => promotedByGroup.get(gg.group_index) === pi.photoId);
    return {
      alias: pi.alias,
      phrase: `${g?.kind || "single"}; E4 ${JSON.stringify(an?.dims || {})}; conf ${an?.confidence ?? "?"}; ${an?.reasons || ""}`,
    };
  });
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

  return {
    selection,
    funnel_report: out.funnel_report || {},
    coverage: out.coverage || "",
    moments,
    analyses,
    groups: groupRecords,
    providerUsed,
  };
}