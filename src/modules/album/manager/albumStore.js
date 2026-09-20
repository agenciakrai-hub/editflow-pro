// Estado del documento de álbum + undo/redo + autosave (Fase 1 §9.6-7). Aislado: solo
// toca entidades Album*; el historial vive dentro del módulo (nunca global).
import { useCallback, useEffect, useRef, useState } from "react";
import { createSpread, deleteSpread, updateSpread, updateAlbum } from "@/modules/album/hooks/useAlbumProject";
import { getLayout } from "@/modules/album/layout/layoutCatalog";
import { applyLayout, bestLayoutFor, expandSlotsToCanvas, freshTransform, makeCustomSlot, photoRatio, sameRatio } from "@/modules/album/layout/layoutEngine";
import { planAutoLayout } from "@/modules/album/layout/autoPlanner";
import { analyzePhotosForLayout } from "@/modules/album/layout/visualAi";
import { applySmartFillToSpread, ensureFaces, retunePhotoSlots, smartFillSlot } from "@/modules/album/editor/smartFill";
import { minZoomForFullOriginal } from "@/modules/album/editor/slotPhotoView";

const HISTORY_LIMIT = 50;
const clone = (x) => JSON.parse(JSON.stringify(x));
const tmpId = () => "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Punto 7 — DISTRIBUCIÓN INTELIGENTE: roles de la Selección IA (hero/key/support/
// detail) convertidos a preferencias de tamaño para el planificador. Se combinan
// con el perfil visual IA cuando existe (nunca lo destruyen: gana el mayor peso).
const ROLE_SIZE = { hero: "large", key: "large", support: "medium", detail: "small" };
const ROLE_IMP = { hero: 85, key: 65, support: 45, detail: 30 };
function applyRoleWeights(profiles, roleOf) {
  if (!roleOf?.size) return profiles;
  for (const [id, role] of roleOf) {
    const size = ROLE_SIZE[role] || "medium";
    const imp = ROLE_IMP[role] ?? 0;
    const prev = profiles.get(id) || { preferredSlot: { size: "medium" }, visualImportance: 0 };
    profiles.set(id, {
      ...prev,
      preferredSlot: { ...(prev.preferredSlot || {}), size },
      visualImportance: Math.max(prev.visualImportance || 0, imp),
    });
  }
  return profiles;
}

export function useAlbumStore(project, initialSpreads, photosById) {
  const [spreads, setSpreads] = useState(initialSpreads);
  const [selectedSpreadId, setSelectedSpreadId] = useState(initialSpreads.length ? initialSpreads[0].id : null);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  // Mejora encuadre — modo de edición del hueco seleccionado: "photo" (UN CLIC sobre
  // la foto: se encuadra la foto, contenedor FIJO) o "container" (DOBLE CLIC: se edita
  // el contenedor con la foto congelada). Huecos vacíos: siempre "container".
  const [slotMode, setSlotMode] = useState("photo");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const spreadsRef = useRef(spreads);
  useEffect(() => { spreadsRef.current = spreads; }, [spreads]);
  // Rellenar contenedor — acceso a las fotos (proporciones reales + caras cacheadas).
  const photosByIdRef = useRef(photosById);
  photosByIdRef.current = photosById;
  // Mano negra — refs del hueco seleccionado y su modo (reglas de activación/salida).
  const selSlotIdRef = useRef(selectedSlotId);
  selSlotIdRef.current = selectedSlotId;
  const slotModeRef = useRef(slotMode);
  slotModeRef.current = slotMode;
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const dirtyRef = useRef(new Map());
  const deletedRef = useRef(new Set());
  const remapRef = useRef(new Map());
  // UNDO/REDO EXACTO — lienzos cuyo borrado ya se PERSISTIÓ en el servidor (flush
  // completado). Rehacer una maquetación (o deshacer un borrado) ya no puede
  // reutilizar ese id: el registro no existe; hay que RE-CREAR el lienzo con
  // identidad nueva conservando plantilla, fotos y transformaciones.
  const goneRef = useRef(new Set());
  const timerRef = useRef(null);
  const flushRef = useRef(null);

  // Resuelve la identidad ACTUAL de un id de snapshot siguiendo la cadena de
  // re-mapeos (tmp→real al persistir, real borrado→tmp nuevo al restaurar). Los
  // snapshots del historial guardan ids antiguos; el registro vivo puede haber
  // cambiado de id varias veces.
  const resolveId = useCallback((id) => {
    let cur = id;
    const seen = new Set();
    while (remapRef.current.has(cur) && !seen.has(cur)) { seen.add(cur); cur = remapRef.current.get(cur); }
    return cur;
  }, []);

  const pushHistory = useCallback(() => {
    undoRef.current.push(clone(spreadsRef.current));
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    setHist({ canUndo: true, canRedo: false });
  }, []);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current?.(), 700);
  }, []);

  const apply = useCallback((next, dirtyIds = [], history = true) => {
    if (history) pushHistory();
    setSpreads(next);
    dirtyIds.forEach((id) => {
      const s = next.find((x) => x.id === id);
      if (s && !deletedRef.current.has(id)) dirtyRef.current.set(id, s);
    });
    scheduleSave();
  }, [pushHistory, scheduleSave]);

  // P3 — el autosave nunca falla en silencio: los cambios pendientes SOLO se quitan de
  // la cola si su escritura tuvo éxito; si algo falla, se avisará al usuario (banner con
  // reintentar) y el estado local permanece intacto.
  const flush = useCallback(async () => {
    if (!dirtyRef.current.size && !deletedRef.current.size) return;
    setSaving(true);
    let failed = false;
    try {
      for (const id of Array.from(deletedRef.current)) {
        try {
          await deleteSpread(id);
          // Borrado persistido: este id ya no existe en el servidor. Si un redo lo
          // recupera, deberá re-crearse con identidad nueva (ver restore).
          goneRef.current.add(id);
          deletedRef.current.delete(id);
          dirtyRef.current.delete(id);
        } catch { failed = true; }
      }
      for (const [id, data] of Array.from(dirtyRef.current.entries())) {
        const payload = {
          project_id: project.id,
          order_index: data.order_index,
          mode: data.mode,
          layout_id: data.layout_id,
          locked: !!data.locked,
          ai_generated: !!data.ai_generated,
          fill_photos: !!data.fill_photos,
          fill_canvas: !!data.fill_canvas,
          // Separación entre fotos PROPIA del lienzo (null = global del álbum).
          ...(data.photo_gap_mm != null ? { photo_gap_mm: data.photo_gap_mm } : {}),
          ...(data.background_color ? { background_color: data.background_color } : {}),
          slots: data.slots || [],
        };
        if (String(id).startsWith("tmp_")) {
          try {
            const rec = await createSpread(payload);
            remapRef.current.set(id, rec.id);
            dirtyRef.current.delete(id);
            setSpreads((prev) => prev.map((s) => (s.id === id ? { ...s, id: rec.id } : s)));
            setSelectedSpreadId((cur) => (cur === id ? rec.id : cur));
          } catch { failed = true; }
        } else {
          try {
            await updateSpread(id, payload);
            dirtyRef.current.delete(id);
          } catch { failed = true; }
        }
      }
      const target = spreadsRef.current.length ? "designing" : null;
      if (target && target !== project.status) {
        try { await updateAlbum(project.id, { status: target }); } catch { failed = true; }
      }
      setSaveError(failed ? "No se pudo guardar parte del álbum. Tus cambios siguen en pantalla y se reintentarán." : null);
    } finally {
      setSaving(false);
    }
  }, [project]);

  useEffect(() => { flushRef.current = flush; }, [flush]);
  // P4 — el timer de autosave nunca sobrevive al desmontaje del editor.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ---- Spreads ----
  const addSpread = useCallback((layoutId = null) => {
    const base = { id: tmpId(), project_id: project.id, order_index: spreadsRef.current.length, mode: "spread", layout_id: "custom", locked: false, ai_generated: false, slots: [] };
    const layout = layoutId ? getLayout(layoutId) : null;
    const next = layout ? applyLayout(base, layout, project) : base;
    apply([...spreadsRef.current, next], [next.id]);
    setSelectedSpreadId(next.id);
    setSelectedSlotId(null);
  }, [apply, project]);

  const deleteSpreadById = useCallback((id) => {
    const removed = spreadsRef.current.find((s) => s.id === id);
    if (!removed) return;
    const list = spreadsRef.current.filter((s) => s.id !== id).map((s, i) => ({ ...s, order_index: i }));
    if (String(id).startsWith("tmp_")) dirtyRef.current.delete(id);
    else deletedRef.current.add(id);
    apply(list, list.map((s) => s.id));
    if (selectedSpreadId === id) setSelectedSpreadId(list.length ? list[Math.max(0, spreadsRef.current.indexOf(removed) - 1)].id : null);
    setSelectedSlotId(null);
  }, [apply, selectedSpreadId]);

  const duplicateSpreadById = useCallback((id) => {
    const src = spreadsRef.current.find((s) => s.id === id);
    if (!src) return;
    const idx = spreadsRef.current.indexOf(src);
    const copy = clone(src);
    copy.id = tmpId();
    const list = [...spreadsRef.current.slice(0, idx + 1), copy, ...spreadsRef.current.slice(idx + 1)].map((s, i) => ({ ...s, order_index: i }));
    apply(list, list.map((s) => s.id));
    setSelectedSpreadId(copy.id);
    setSelectedSlotId(null);
  }, [apply]);

  const moveSpread = useCallback((id, dir) => {
    const idx = spreadsRef.current.findIndex((s) => s.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= spreadsRef.current.length) return;
    const list = [...spreadsRef.current];
    const [moved] = list.splice(idx, 1);
    list.splice(to, 0, moved);
    apply(list.map((s, i) => ({ ...s, order_index: i })), list.map((s) => s.id));
    setSelectedSpreadId(id);
  }, [apply]);

  const reorderSpreads = useCallback((fromId, toId) => {
    const list = [...spreadsRef.current];
    const from = list.findIndex((s) => s.id === fromId);
    const to = list.findIndex((s) => s.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    apply(list.map((s, i) => ({ ...s, order_index: i })), list.map((s) => s.id));
    setSelectedSpreadId(moved.id);
  }, [apply]);

  const setSpreadLayoutById = useCallback(async (id, layoutId) => {
    const s = spreadsRef.current.find((x) => x.id === id);
    if (!s || s.locked) return;
    const layout = getLayout(layoutId);
    let next;
    if (layout) next = applyLayout(s, layout, project);
    else next = { ...s, layout_id: "custom" };
    // Relleno completo del lienzo activo: la plantilla nueva se aplica YA expandida.
    if (next.fill_canvas) next = { ...next, slots: expandSlotsToCanvas(project, next.mode, next.slots || []) };
    // Rellenar contenedor: plantilla nueva con la herramienta activa en ESTE lienzo →
    // los huecos con foto se rellenan automáticamente (COVER con prioridad de caras).
    if (next.fill_photos) next = await applySmartFillToSpread(next, photosByIdRef.current, project.id);
    apply(spreadsRef.current.map((x) => (x.id === id ? next : x)), [id]);
    setSelectedSlotId(null);
  }, [apply, project]);

  // Colocación múltiple — aplica al lienzo ACTUAL (sin fotos) la plantilla elegida
  // automáticamente y asigna las fotos a los huecos según el matching por proporción
  // (assignment alineado al orden de slots; null = hueco vacío). Ajuste automático
  // al contenedor: cada foto COLOCADA llena su hueco (cover, proporción original,
  // sin espacios vacíos) con protección de caras/punto focal de la IA visual.
  // ENCUADRE INTELIGENTE AUTOMÁTICO — al colocar una foto (asignación, movimiento,
  // colocación múltiple, aplicación de plantilla) se aplica SIEMPRE Smart Cover /
  // Face-Aware: la foto cubre el contenedor priorizando las caras detectadas y
  // calculando scale + offset automáticamente. El original NUNCA se recorta: el
  // contenedor es una ventana visual (transform virtual: scale + offsets); el
  // usuario puede alejar el zoom y recuperar cualquier zona del original. El modo
  // (fill/fit) queda fijado por el hueco; el botón "Rellenar contenedor" del lienzo
  // y los botones "Relleno"/"Contener" del hueco siguen cambiándolo a voluntad.
  const fitOrSmartFillSlot = useCallback((sl, photo, spread) => {
    if (!sl || !photo) return { fit_mode: "fit", transform: freshTransform() };
    return smartFillSlot(sl, photo);
  }, []);

  const applyAutoLayout = useCallback(async (id, layoutId, photoIds) => {
    const s = spreadsRef.current.find((x) => x.id === id);
    if (!s || s.locked) return;
    const layout = getLayout(layoutId);
    if (!layout) return;
    const next = applyLayout(s, layout, project);
    next.slots = (next.slots || []).map((sl, i) => ({ ...sl, photo_id: photoIds?.[i] ?? null }));
    if (next.fill_canvas) next = { ...next, slots: expandSlotsToCanvas(project, next.mode, next.slots || []) };
    // Punto 1 — respeta fill_photos del lienzo.
    next.slots = next.slots.map((sl) => {
      if (!sl.photo_id) return sl;
      const photo = photosByIdRef.current.get(sl.photo_id);
      if (!photo) return sl;
      const f = fitOrSmartFillSlot(sl, photo, s);
      return { ...sl, fit_mode: f.fit_mode, transform: f.transform };
    });
    apply(spreadsRef.current.map((x) => (x.id === id ? next : x)), [id]);
    setSelectedSlotId(null);
  }, [apply, project, fitOrSmartFillSlot]);

  // Colocación múltiple — crea un lienzo NUEVO con la plantilla automática y las
  // fotos. Ajuste automático al contenedor (cover inteligente con protección de
  // caras): igual que el resto de colocaciones.
  const addSpreadWithAutoLayout = useCallback(async (layoutId, photoIds) => {
    const base = { id: tmpId(), project_id: project.id, order_index: spreadsRef.current.length, mode: "spread", layout_id: layoutId, locked: false, ai_generated: false, fill_photos: false, slots: [] };
    const layout = getLayout(layoutId);
    const built = layout ? applyLayout(base, layout, project) : base;
    const next = {
      ...built,
      slots: (built.slots || []).map((sl, i) => ({ ...sl, photo_id: photoIds?.[i] ?? null })),
    };
    // Punto 1 — lienzo nuevo nace con fill_photos=false → FIT.
    const filled = {
      ...next,
      slots: next.slots.map((sl) => sl.photo_id ? { ...sl, fit_mode: "fit", transform: freshTransform() } : sl),
    };
    apply([...spreadsRef.current, filled], [filled.id]);
    setSelectedSpreadId(filled.id);
    setSelectedSlotId(null);
  }, [apply, project]);

  // ---- Asistencia IA — MAQUETACIÓN AUTOMÁTICA (puntos 1/5/8/9/10) ----
  // PREPARA el plan SIN aplicarlo: analiza las fotos con IA visual (si hay
  // consentimiento), filtra las ya colocadas (punto 8), calcula el plan DP dentro
  // del MÁXIMO TOTAL de lienzos (punto 5) y devuelve un resumen para previsualizar.
  // La aplicación es atómica y posterior (applyAutoLayoutPlan): ⌘Z deshace TODA la
  // maquetación (punto 10). Los lienzos se crean con fill_photos=false → FIT (foto
  // completa, sin recorte automático); la IA NUNCA activa COVER por su cuenta (punto 1).
  const prepareAutoLayoutPlan = useCallback(async (photoIds, opts = {}) => {
    // Punto 8 — una foto solo puede aparecer una vez: filtra las ya colocadas.
    // En regeneración, los lienzos NO bloqueados se van a eliminar: sus fotos se
    // liberan y NO se filtran (solo cuentan las de lienzos bloqueados que permanecen).
    const isRegen = opts?.mode === "regenerate" || opts?.mode === "regenerateAll";
    const placedIds = new Set();
    spreadsRef.current.forEach((s) => {
      if (isRegen && !s.locked) return;
      (s.slots || []).forEach((sl) => { if (sl.photo_id) placedIds.add(sl.photo_id); });
    });
    const ordered = (photoIds || []).filter((id) => !placedIds.has(id)).map((id) => photosByIdRef.current.get(id)).filter(Boolean);
    if (!ordered.length) return null;
    let profiles = new Map();
    try { profiles = await analyzePhotosForLayout(project.id, ordered); } catch { profiles = new Map(); }
    profiles = applyRoleWeights(profiles, opts?.roleOf);
    // Punto 5 — el límite es el MÁXIMO TOTAL del álbum. En regeneración solo los
    // lienzos bloqueados permanecen (existingCount = locked). En create, todos
    // los actuales. La IA solo puede crear el complemento hasta alcanzar el límite.
    const existingCount = isRegen
      ? spreadsRef.current.filter((s) => s.locked).length
      : spreadsRef.current.length;
    const plan = planAutoLayout(project, ordered, profiles, {
      maxSpreads: opts?.maxSpreads,
      existingCount,
      simGroups: opts?.simGroups,
      priority: opts?.priority,
      maxPerSpread: opts?.maxPerSpread,
    });
    // Punto 7 — fotos descartadas por similitud (estimación: fotos del mismo grupo
    // de ráfaga que no entraron porque el planificador las penalizó).
    let discardedBySim = 0;
    if (opts?.simGroups?.size && plan.leftover.length) {
      const usedGroups = new Set();
      plan.groups.forEach((g) => g.assignment.forEach((id) => { if (id) { const sg = opts.simGroups.get(id); if (sg != null) usedGroups.add(sg); } }));
      plan.leftover.forEach((p) => { const sg = opts.simGroups.get(p.id); if (sg != null && usedGroups.has(sg)) discardedBySim++; });
    }
    return {
      plan,
      summary: {
        analyzed: ordered.length,
        placed: ordered.length - plan.leftover.length,
        leftover: plan.leftover.length,
        discardedBySim,
        currentSpreads: spreadsRef.current.length,
        maxSpreads: Number(opts?.maxSpreads) || null,
        newSpreads: plan.groups.length,
        finalSpreads: existingCount + plan.groups.length,
        usedAi: profiles.size > 0,
      },
    };
  }, [project]);

  // Aplica el plan preparado en UNA operación atómica (punto 10: ⌘Z deshace todo).
  // Punto 1 — los lienzos nuevos nacen con fill_photos=false → FIT (foto completa,
  // centrada, sin recorte). La IA NUNCA activa COVER automáticamente.
  const applyAutoLayoutPlan = useCallback(async (prepared) => {
    if (!prepared?.plan?.groups?.length) return null;
    const { plan } = prepared;
    const list = [...spreadsRef.current];
    const created = [];
    for (const g of plan.groups) {
      const base = {
        id: tmpId(), project_id: project.id, order_index: list.length, mode: "spread",
        layout_id: g.layoutId, locked: false, ai_generated: true,
        fill_photos: false, fill_canvas: false, photo_gap_mm: null, background_color: null, slots: [],
      };
      const next = applyLayout(base, g.layout, project);
      next.slots = (next.slots || []).map((sl, i) => ({ ...sl, photo_id: g.assignment[i] ?? null }));
      // Punto 1 — fill_photos=false → FIT (foto completa, sin recorte, transform limpio).
      // La IA no activa COVER: el fotógrafo lo hace manualmente con «Rellenar contenedor».
      const filled = {
        ...next,
        slots: next.slots.map((sl) => sl.photo_id ? { ...sl, fit_mode: "fit", transform: freshTransform() } : sl),
      };
      created.push(filled);
      list.push(filled);
    }
    apply(list, created.map((s) => s.id));
    setSelectedSpreadId(created[0].id);
    setSelectedSlotId(null);
    return prepared.summary;
  }, [apply, project]);

  // Legado — maquetación directa sin previsualización (compatibilidad).
  const autoLayoutPhotos = useCallback(async (photoIds, opts = {}) => {
    const prepared = await prepareAutoLayoutPlan(photoIds, opts);
    if (!prepared) return null;
    return applyAutoLayoutPlan(prepared);
  }, [prepareAutoLayoutPlan, applyAutoLayoutPlan]);

  // REGENERACIÓN SELECTIVA (punto 13) — re-elige la mejor plantilla para las fotos
  // que YA están en este lienzo y la reaplica EN SU SITIO (mismo id, mismo orden).
  // No toca lienzos bloqueados: el usuario mantiene prioridad (punto 11). Una sola
  // entrada de historial (⌘Z deshace la regeneración del lienzo).
  const regenerateSpread = useCallback(async (spreadId) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    if (!s || s.locked) return null;
    const objs = (s.slots || []).map((sl) => sl.photo_id).filter(Boolean).map((id) => photosByIdRef.current.get(id)).filter(Boolean);
    if (!objs.length) return null;
    const pick = bestLayoutFor(project, objs);
    if (!pick) return null;
    await applyAutoLayout(spreadId, pick.layout.id, pick.assignment);
    return { layoutId: pick.layout.id, count: objs.length };
  }, [applyAutoLayout, project]);

  // REGENERACIÓN SELECTIVA (punto 13) — rehace la maquetación de TODOS los lienzos
  // NO bloqueados (los bloqueados permanecen intactos: punto 11/12). Recoge sus
  // fotos, las reordena por el orden estable del catálogo y vuelve a planificarlas
  // dentro del límite, respetando prioridad y similitud. Los lienzos nuevos se
  // añaden tras los bloqueados. Una sola entrada de historial (⌘Z deshace toda
  // la regeneración). No se pierden fotos: las que no entran quedan sin colocar.
  const regenerateNonLocked = useCallback(async (opts = {}) => {
    const current = spreadsRef.current;
    const keep = current.filter((s) => s.locked);
    const remove = current.filter((s) => !s.locked);
    if (!remove.length) return null;
    const photoIds = [];
    remove.forEach((s) => (s.slots || []).forEach((sl) => { if (sl.photo_id) photoIds.push(sl.photo_id); }));
    const ordered = photoIds.map((id) => photosByIdRef.current.get(id)).filter(Boolean);
    if (!ordered.length) return null;
    let profiles = new Map();
    try { profiles = await analyzePhotosForLayout(project.id, ordered); } catch { profiles = new Map(); }
    profiles = applyRoleWeights(profiles, opts?.roleOf);
    // Punto 5 — el límite es el MÁXIMO TOTAL: los lienzos bloqueados (keep) cuentan.
    // La IA solo puede crear (maxSpreads - keep.length) lienzos nuevos para los no bloqueados.
    const plan = planAutoLayout(project, ordered, profiles, {
      maxSpreads: opts?.maxSpreads, existingCount: keep.length, simGroups: opts?.simGroups, priority: opts?.priority, maxPerSpread: opts?.maxPerSpread,
    });
    if (!plan.groups.length) return null;
    pushHistory();
    remove.forEach((s) => { if (String(s.id).startsWith("tmp_")) dirtyRef.current.delete(s.id); else deletedRef.current.add(s.id); });
    const list = keep.map((s, i) => ({ ...s, order_index: i }));
    const created = [];
    for (const g of plan.groups) {
      const base = { id: tmpId(), project_id: project.id, order_index: list.length, mode: "spread", layout_id: g.layoutId, locked: false, ai_generated: true, fill_photos: false, fill_canvas: false, photo_gap_mm: null, background_color: null, slots: [] };
      const next = applyLayout(base, g.layout, project);
      next.slots = (next.slots || []).map((sl, i) => ({ ...sl, photo_id: g.assignment[i] ?? null }));
      // Punto 1 — fill_photos=false → FIT (foto completa, sin recorte automático).
      const filled = {
        ...next,
        slots: next.slots.map((sl) => sl.photo_id ? { ...sl, fit_mode: "fit", transform: freshTransform() } : sl),
      };
      created.push(filled);
      list.push(filled);
    }
    setSpreads(list);
    created.forEach((s) => dirtyRef.current.set(s.id, s));
    keep.forEach((s) => dirtyRef.current.set(s.id, s));
    scheduleSave();
    setSelectedSpreadId(created[0]?.id || (keep[0]?.id ?? null));
    setSelectedSlotId(null);
    return { total: ordered.length, placed: ordered.length - plan.leftover.length, leftover: plan.leftover.length, spreadCount: created.length, keptLocked: keep.length, usedAi: profiles.size > 0 };
  }, [pushHistory, scheduleSave, project]);

  // Regla de colocación (arrastre de varias fotos sobre un lienzo CON huecos
  // vacíos): llena SOLO los huecos vacíos del lienzo actual, emparejando fotos y
  // huecos por proporción (verticales con verticales, horizontales con
  // horizontales — mismo criterio determinista del motor), SIN cambiar la
  // plantilla, sin crear lienzos y sin tocar las fotos ya colocadas ni otros
  // lienzos. Ajuste inicial según la herramienta de ESTE lienzo: FIT/CONTAIN
  // (foto completa, centrada) o COVER inteligente con prioridad de caras si
  // «Rellenar contenedor» está activo. UNA operación atómica (⌘Z deshace todo).
  const fillEmptySlotsWithPhotos = useCallback(async (spreadId, photoIds) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    if (!s || s.locked) return null;
    const photos = (photoIds || []).map((id) => photosByIdRef.current.get(id)).filter(Boolean);
    const empty = (s.slots || []).filter((sl) => !sl.photo_id && sl.w_mm > 0 && sl.h_mm > 0);
    if (!photos.length || !empty.length) return null;
    // Punto 1 — prepara caras solo si fill_photos está activo (COVER); si no, FIT.
    if (s.fill_photos) await Promise.all(photos.map((p) => ensureFaces(project.id, p)));
    const slotsSorted = empty.map((sl) => ({ sl, ratio: sl.w_mm / sl.h_mm })).sort((a, b) => a.ratio - b.ratio);
    const photosSorted = photos.map((p) => ({ p, ratio: photoRatio(p) })).sort((a, b) => a.ratio - b.ratio);
    const bySlot = new Map();
    const n = Math.min(slotsSorted.length, photosSorted.length);
    for (let k = 0; k < n; k++) bySlot.set(slotsSorted[k].sl.slot_id, photosSorted[k].p);
    const next = {
      ...s,
      slots: (s.slots || []).map((sl) => {
        const photo = bySlot.get(sl.slot_id);
        if (!photo) return sl;
        const f = fitOrSmartFillSlot(sl, photo, s);
        return { ...sl, photo_id: photo.id, fit_mode: f.fit_mode, transform: f.transform };
      }),
    };
    apply(spreadsRef.current.map((x) => (x.id === spreadId ? next : x)), [spreadId]);
    return { placed: n, unplaced: photos.length - n };
  }, [apply, project.id]);

  const setLocked = useCallback((id, locked) => {
    apply(spreadsRef.current.map((x) => (x.id === id ? { ...x, locked } : x)), [id]);
  }, [apply]);

  // Rellenar contenedor — herramienta POR LIENZO. ON: las fotos del lienzo ACTUAL
  // pasan a COVER inteligente (prioridad de caras) en una sola operación de undo/redo.
  // OFF: vuelven a FIT/CONTAIN (foto completa, encuadre inicial). Nunca toca otros
  // lienzos: solo se mapea el spread indicado.
  const setSpreadFill = useCallback(async (id, fill) => {
    const s = spreadsRef.current.find((x) => x.id === id);
    if (!s || s.locked) return;
    let next = {
      ...s,
      fill_photos: !!fill,
      slots: (s.slots || []).map((sl) =>
        sl.photo_id && !fill ? { ...sl, fit_mode: "fit", transform: freshTransform() } : sl
      ),
    };
    if (fill) next = await applySmartFillToSpread(next, photosByIdRef.current, project.id);
    apply(spreadsRef.current.map((x) => (x.id === id ? next : x)), [id]);
  }, [apply, project.id]);

  // Relleno completo del lienzo — POR LIENZO (geometría de la PLANTILLA; independiente
  // de "Rellenar contenedor", que ajusta cada foto). ON: los huecos se expanden hasta
  // ocupar todo el lienzo conservando EXACTA la separación entre fotos. OFF: se
  // restaura la GEOMETRÍA BASE re-aplicando la plantilla del catálogo (nunca se calcula
  // hacia atrás desde la geometría expandida → sin error acumulativo y ⌘Z exacto).
  // Solo se toca el lienzo indicado; las fotos nunca se pierden.
  const setSpreadCanvasFill = useCallback(async (id, fill) => {
    const s = spreadsRef.current.find((x) => x.id === id);
    if (!s || s.locked || !s.layout_id || s.layout_id === "custom") return;
    const oldSlots = s.slots || [];
    let next;
    if (fill) {
      next = { ...s, fill_canvas: true, slots: expandSlotsToCanvas(project, s.mode, oldSlots) };
    } else {
      const layout = getLayout(s.layout_id);
      next = layout ? applyLayout(s, layout, project) : { ...s };
      next = { ...next, fill_canvas: false };
    }
    // Ajuste de fotos con las reglas existentes: encuadre conservado si la proporción
    // del hueco no cambia; FIT fresco (o COVER inteligente si "Rellenar contenedor"
    // está activo) si cambia.
    next.slots = await retunePhotoSlots(oldSlots, next.slots || [], {
      fillPhotos: !!s.fill_photos, photosById: photosByIdRef.current, projectId: project.id,
    });
    apply(spreadsRef.current.map((x) => (x.id === id ? next : x)), [id]);
  }, [apply, project]);

  // Fase Lienzos — recalcula la geometría de TODOS los lienzos con plantilla (no
  // "custom" y no bloqueados) tras un cambio global (p. ej. el espacio entre fotos).
  // Las fotos y sus crops se conservan: applyLayout reasigna por orden y mantiene el
  // transform de cada foto. Relleno completo del lienzo: tras re-resolver la base se
  // vuelve a expandir la geometría de los lienzos que lo tienen activo (la separación
  // nueva queda aplicada: expandSlotsToCanvas conserva los espacios interiores).
  const refreshTemplateSpreads = useCallback(async (album) => {
    const out = [];
    for (const s of spreadsRef.current) {
      if (s.locked || !s.layout_id || s.layout_id === "custom") { out.push(s); continue; }
      const l = getLayout(s.layout_id);
      if (!l) { out.push(s); continue; }
      const base = applyLayout(s, l, album);
      if (!s.fill_canvas) { out.push(base); continue; }
      const expanded = { ...base, slots: expandSlotsToCanvas(album, s.mode, base.slots || []) };
      expanded.slots = await retunePhotoSlots(s.slots || [], expanded.slots, {
        fillPhotos: !!s.fill_photos, photosById: photosByIdRef.current, projectId: project.id,
      });
      out.push(expanded);
    }
    apply(out, out.map((x) => x.id));
  }, [apply, project.id]);

  // ---- Slots ----
  const updateSlot = useCallback((spreadId, slotId, patch, history = true) => {
    const list = spreadsRef.current.map((s) => {
      if (s.id !== spreadId) return s;
      return {
        ...s,
        slots: (s.slots || []).map((sl) => {
          if (sl.slot_id !== slotId) return sl;
          const t = patch.transform ? { ...sl.transform, ...patch.transform } : sl.transform;
          const merged = { ...sl, ...patch, transform: t };
          // Cambio de ajuste desde Propiedades: «Relleno» aplica el COVER inteligente
          // (escala ≥ base cover con margen de reencuadre real: la foto sigue siendo
          // AJUSTABLE y cubre siempre el contenedor); «Contener» restaura la foto
          // completa, centrada (sin offsets huérfanos del otro modo).
          if (patch.fit_mode && merged.photo_id) {
            if (patch.fit_mode === "fill") {
              const photo = photosByIdRef.current.get(merged.photo_id);
              if (photo) { const f = smartFillSlot(merged, photo); merged.fit_mode = f.fit_mode; merged.transform = f.transform; }
            } else {
              merged.transform = freshTransform();
            }
          }
          // Al cambiar la proporción del contenedor: recalcula el encuadre según el
          // MODO del propio hueco (no del lienzo). fit_mode "fill" → Smart Cover
          // (caras + focal point, recálculo no destructivo: transform virtual). fit_mode
          // "fit" → FIT fresco (foto completa, centrada). El original jamás se recorta.
          if ((patch.w_mm != null || patch.h_mm != null) && merged.photo_id) {
            if (!sameRatio(sl.w_mm, sl.h_mm, merged.w_mm, merged.h_mm)) {
              if (merged.fit_mode === "fill") {
                const photo = photosByIdRef.current.get(merged.photo_id);
                if (photo) {
                  const f = smartFillSlot(merged, photo);
                  merged.fit_mode = f.fit_mode;
                  merged.transform = f.transform;
                } else {
                  merged.transform = freshTransform();
                  merged.fit_mode = "fit";
                }
              } else {
                merged.transform = freshTransform();
                merged.fit_mode = "fit";
              }
            }
          }
          return merged;
        }),
      };
    });
    apply(list, [spreadId], history);
  }, [apply]);

  // Zoom de la FOTO de un hueco (rueda del lienzo): lee la escala del estado VIVO
  // (ref), nunca de un snapshot antiguo del render. El MÍNIMO es DINÁMICO: en modo
  // RELLENO (cover) permite alejar hasta recuperar el 100 % del original completo
  // (containScale según la proporción foto/hueco — puede ser muy inferior a 0.3 en
  // proporciones extremas; aparecen huecos vacíos, lo cual es CORRECTO). El máximo
  // 800 % se mantiene. El zoom es una transformación VIRTUAL: no recorta ni destruye
  // el original, no modifica posiciones ni datos persistidos más allá de transform.
  const zoomSlotPhoto = useCallback((spreadId, slotId, factor) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    const sl = (s?.slots || []).find((x) => x.slot_id === slotId);
    const photo = sl?.photo_id ? photosByIdRef.current.get(sl.photo_id) : null;
    const minZ = minZoomForFullOriginal(sl, photo);
    const next = Math.min(8, Math.max(minZ, (sl?.transform?.scale ?? 1) * factor));
    updateSlot(spreadId, slotId, { transform: { scale: Math.round(next * 100) / 100 } }, false);
  }, [updateSlot]);

  // Mano negra persistente: un clic sobre el MISMO hueco en modo contenedor NO lo
  // desactiva (la foto no cambia). Solo se sale con clic FUERA del hueco o con
  // doble clic en el propio hueco.
  const selectSlot = useCallback((slotId) => {
    if (slotId && selSlotIdRef.current === slotId && slotModeRef.current === "container") return;
    setSelectedSlotId(slotId);
    if (slotId) setSlotMode("photo");
  }, []);
  const selectSlotContainer = useCallback((slotId) => {
    setSelectedSlotId(slotId);
    if (slotId) setSlotMode("container");
  }, []);
  // Doble clic sobre el hueco: activa el modo contenedor (mano negra) o, si YA está
  // activo en este hueco, vuelve al modo foto (mano verde).
  const toggleSlotContainerMode = useCallback((slotId) => {
    if (slotId && selSlotIdRef.current === slotId && slotModeRef.current === "container") setSlotMode("photo");
    else selectSlotContainer(slotId);
  }, [selectSlotContainer]);

 // Punto 1/14 — al colocar una foto: respeta fill_photos del lienzo. false → FIT
  // (foto completa, centrada, sin recorte); true → SMART COVER (caras + focal point).
  const assignPhotoToSlot = useCallback(async (spreadId, slotId, photoId) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    const photo = photoId ? photosByIdRef.current.get(photoId) : null;
    if (photo) {
      if (s?.fill_photos) await ensureFaces(project.id, photo);
      const sl = (s?.slots || []).find((x) => x.slot_id === slotId);
      const f = sl ? fitOrSmartFillSlot(sl, photo, s) : null;
      updateSlot(spreadId, slotId, { photo_id: photoId, ...(f ? { fit_mode: f.fit_mode, transform: f.transform } : { transform: freshTransform(), fit_mode: "fit" }) });
    } else {
      updateSlot(spreadId, slotId, { photo_id: photoId, transform: freshTransform(), fit_mode: "fit" });
    }
    selectSlot(slotId);
  }, [updateSlot, selectSlot, project.id, fitOrSmartFillSlot]);

  const removePhotoFromSlot = useCallback((spreadId, slotId) => {
    updateSlot(spreadId, slotId, { photo_id: null, transform: freshTransform() });
  }, [updateSlot]);

  // Punto 1/3 — al mover una foto entre huecos: respeta fill_photos del lienzo.
  // false → FIT (foto completa, centrada); true → SMART COVER (caras + focal point).
  // Nunca COVER automático si la herramienta está OFF. Al ser asíncrono, prepara
  // caras solo si fill_photos está activo (igual que assignPhotoToSlot).
  const movePhotoBetweenSlots = useCallback(async (spreadId, fromSlotId, toSlotId) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    if (!s) return;
    const from = (s.slots || []).find((x) => x.slot_id === fromSlotId);
    const to = (s.slots || []).find((x) => x.slot_id === toSlotId);
    if (!from || !to) return;
    // Prepara caras de ambas fotos si fill_photos está activo (COVER inteligente).
    if (s.fill_photos) {
      const ids = [from.photo_id, to.photo_id].filter(Boolean);
      await Promise.all(ids.map((id) => ensureFaces(project.id, photosByIdRef.current.get(id))));
    }
    const list = spreadsRef.current.map((x) => {
      if (x.id !== spreadId) return x;
      const fillFor = (slotId, pid) => {
        const photo = pid ? photosByIdRef.current.get(pid) : null;
        const sl = (s.slots || []).find((z) => z.slot_id === slotId);
        if (photo && sl) {
          const f = fitOrSmartFillSlot(sl, photo, s);
          return { fit_mode: f.fit_mode, transform: f.transform };
        }
        return { transform: freshTransform(), fit_mode: "fit" };
      };
      return {
        ...x,
        slots: x.slots.map((sl) =>
          sl.slot_id === fromSlotId ? { ...sl, photo_id: to.photo_id, ...fillFor(fromSlotId, to.photo_id) }
            : sl.slot_id === toSlotId ? { ...sl, photo_id: from.photo_id, ...fillFor(toSlotId, from.photo_id) }
            : sl
        ),
      };
    });
    apply(list, [spreadId]);
  }, [apply, project.id, fitOrSmartFillSlot]);

  const addSlotWithPhoto = useCallback(async (spreadId, photoId) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    if (!s) return;
    const slot = makeCustomSlot(project, photoId);
    // Punto 1 — respeta fill_photos del lienzo.
    const photo = photoId ? photosByIdRef.current.get(photoId) : null;
    if (photo) {
      if (s.fill_photos) await ensureFaces(project.id, photo);
      const f = fitOrSmartFillSlot(slot, photo, s);
      slot.fit_mode = f.fit_mode;
      slot.transform = f.transform;
    }
    apply(spreadsRef.current.map((x) => (x.id === spreadId ? { ...x, layout_id: x.layout_id || "custom", slots: [...(x.slots || []), slot] } : x)), [spreadId]);
    setSelectedSlotId(slot.slot_id);
  }, [apply, project, fitOrSmartFillSlot]);

  const removeSlot = useCallback((spreadId, slotId) => {
    apply(spreadsRef.current.map((x) => (x.id !== spreadId ? x : { ...x, slots: (x.slots || []).filter((sl) => sl.slot_id !== slotId) })), [spreadId]);
    setSelectedSlotId(null);
  }, [apply]);

  // REGENERACIÓN SELECTIVA (punto 12) — «Regenerar álbum»: rehace TODOS los lienzos
  // no bloqueados (igual que regenerateNonLocked, pero parte de TODAS las fotos del
  // álbum, no solo las colocadas en no bloqueados: incluye fotos sin colocar que el
  // fotógrafo quiere incorporar). Los bloqueados siempre quedan intactos (punto 11).
  const regenerateAll = useCallback(async (opts = {}) => {
    const current = spreadsRef.current;
    const keep = current.filter((s) => s.locked);
    const remove = current.filter((s) => !s.locked);
    // Recoge fotos de los no bloqueados + fotos sin colocar de TODO el álbum.
    const placedIds = new Set();
    current.forEach((s) => (s.slots || []).forEach((sl) => { if (sl.photo_id) placedIds.add(sl.photo_id); }));
    const photoIds = [];
    remove.forEach((s) => (s.slots || []).forEach((sl) => { if (sl.photo_id) photoIds.push(sl.photo_id); }));
    // Añade fotos sin colocar (que no están en ningún lienzo).
    photosByIdRef.current.forEach((p) => { if (!placedIds.has(p.id)) photoIds.push(p.id); });
    const ordered = photoIds.map((id) => photosByIdRef.current.get(id)).filter(Boolean);
    if (!ordered.length) return null;
    let profiles = new Map();
    try { profiles = await analyzePhotosForLayout(project.id, ordered); } catch { profiles = new Map(); }
    profiles = applyRoleWeights(profiles, opts?.roleOf);
    const plan = planAutoLayout(project, ordered, profiles, {
      maxSpreads: opts?.maxSpreads, existingCount: keep.length, simGroups: opts?.simGroups, priority: opts?.priority, maxPerSpread: opts?.maxPerSpread,
    });
    if (!plan.groups.length) return null;
    pushHistory();
    remove.forEach((s) => { if (String(s.id).startsWith("tmp_")) dirtyRef.current.delete(s.id); else deletedRef.current.add(s.id); });
    const list = keep.map((s, i) => ({ ...s, order_index: i }));
    const created = [];
    for (const g of plan.groups) {
      const base = { id: tmpId(), project_id: project.id, order_index: list.length, mode: "spread", layout_id: g.layoutId, locked: false, ai_generated: true, fill_photos: false, fill_canvas: false, photo_gap_mm: null, background_color: null, slots: [] };
      const next = applyLayout(base, g.layout, project);
      next.slots = (next.slots || []).map((sl, i) => ({ ...sl, photo_id: g.assignment[i] ?? null }));
      const filled = { ...next, slots: next.slots.map((sl) => sl.photo_id ? { ...sl, fit_mode: "fit", transform: freshTransform() } : sl) };
      created.push(filled);
      list.push(filled);
    }
    setSpreads(list);
    created.forEach((s) => dirtyRef.current.set(s.id, s));
    keep.forEach((s) => dirtyRef.current.set(s.id, s));
    scheduleSave();
    setSelectedSpreadId(created[0]?.id || (keep[0]?.id ?? null));
    setSelectedSlotId(null);
    return { total: ordered.length, placed: ordered.length - plan.leftover.length, leftover: plan.leftover.length, spreadCount: created.length, keptLocked: keep.length, usedAi: profiles.size > 0 };
  }, [pushHistory, scheduleSave, project]);

  // Gesturas (pan/zoom/resize): una sola entrada de historial por gesto.
  const gestureBegin = useCallback(() => pushHistory(), [pushHistory]);

  // ---- Undo / Redo (solo el documento de este álbum) ----
  const restore = useCallback((snap) => {
    const current = spreadsRef.current;
    // 1) Cada id del snapshot se resuelve a su identidad ACTUAL (cadenas de remap).
    // 2) Si esa identidad ya no existe en el servidor (borrado persistido por un
    //    undo cuyo autosave llegó a correr — el caso normal entre ⌘Z y ⌘⇧Z), el
    //    lienzo se RE-CREA con id nuevo: plantilla, fotos, transforms y
    //    configuración local se conservan íntegras.
    const restored = snap.map((s) => {
      const id = resolveId(s.id);
      let out = id === s.id ? s : { ...s, id };
      if (goneRef.current.has(id)) {
        const nid = tmpId();
        remapRef.current.set(id, nid);
        goneRef.current.delete(id);
        out = { ...out, id: nid };
      }
      return out;
    });
    current.forEach((s) => {
      if (!restored.some((r) => r.id === s.id) && !String(s.id).startsWith("tmp_")) deletedRef.current.add(s.id);
      dirtyRef.current.delete(s.id);
    });
    // Todo lienzo que VUELVE en el snapshot se "des-borra" (sale de deletedRef) y se
    // marca sucio para persistir: rehacer una maquetación cuyos lienzos tenían id
    // real o pendiente de borrar debe restaurarla EXACTAMENTE, sin borrados
    // pendientes que el siguiente guardado ejecutaría por error.
    restored.forEach((s) => { deletedRef.current.delete(s.id); dirtyRef.current.set(s.id, s); });
    setSpreads(restored);
    setSelectedSpreadId((cur) => {
      const c = resolveId(cur);
      const hit = restored.find((r) => r.id === c);
      return hit ? hit.id : restored.length ? restored[0].id : null;
    });
    setSelectedSlotId(null);
    scheduleSave();
  }, [scheduleSave, resolveId]);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(clone(spreadsRef.current));
    restore(prev);
    setHist({ canUndo: undoRef.current.length > 0, canRedo: true });
  }, [restore]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(clone(spreadsRef.current));
    restore(next);
    setHist({ canUndo: true, canRedo: redoRef.current.length > 0 });
  }, [restore]);

  const sorted = [...spreads].sort((a, b) => a.order_index - b.order_index);
  const selectedSpread = sorted.find((s) => s.id === selectedSpreadId) || sorted[0] || null;

  return {
    spreads: sorted, selectedSpread, selectedSpreadId, selectedSlotId, slotMode,
    selectSpread: setSelectedSpreadId, selectSlot, selectSlotContainer, toggleSlotContainerMode,
    addSpread, deleteSpreadById, duplicateSpreadById, moveSpread, reorderSpreads,
    setSpreadLayoutById, applyAutoLayout, addSpreadWithAutoLayout, autoLayoutPhotos, prepareAutoLayoutPlan, applyAutoLayoutPlan, regenerateSpread, regenerateNonLocked, regenerateAll, fillEmptySlotsWithPhotos, setLocked, setSpreadFill, setSpreadCanvasFill, refreshTemplateSpreads,
    updateSlot, zoomSlotPhoto, assignPhotoToSlot, removePhotoFromSlot, movePhotoBetweenSlots,
    addSlotWithPhoto, removeSlot, gestureBegin,
    undo, redo, canUndo: hist.canUndo, canRedo: hist.canRedo, saving, saveError, retrySave: flush, flush,
  };
}