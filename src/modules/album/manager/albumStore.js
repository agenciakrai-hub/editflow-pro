// Estado del documento de álbum + undo/redo + autosave (Fase 1 §9.6-7). Aislado: solo
// toca entidades Album*; el historial vive dentro del módulo (nunca global).
import { useCallback, useEffect, useRef, useState } from "react";
import { createSpread, deleteSpread, updateSpread, updateAlbum } from "@/modules/album/hooks/useAlbumProject";
import { getLayout } from "@/modules/album/layout/layoutCatalog";
import { applyLayout, fitTransform, freshTransform, makeCustomSlot } from "@/modules/album/layout/layoutEngine";

const HISTORY_LIMIT = 50;
const clone = (x) => JSON.parse(JSON.stringify(x));
const tmpId = () => "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function useAlbumStore(project, initialSpreads) {
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
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const dirtyRef = useRef(new Map());
  const deletedRef = useRef(new Set());
  const remapRef = useRef(new Map());
  const timerRef = useRef(null);
  const flushRef = useRef(null);

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

  const setSpreadLayoutById = useCallback((id, layoutId) => {
    const s = spreadsRef.current.find((x) => x.id === id);
    if (!s || s.locked) return;
    const layout = getLayout(layoutId);
    let next;
    if (layout) next = applyLayout(s, layout, project);
    else next = { ...s, layout_id: "custom" };
    apply(spreadsRef.current.map((x) => (x.id === id ? next : x)), [id]);
    setSelectedSlotId(null);
  }, [apply, project]);

  const setLocked = useCallback((id, locked) => {
    apply(spreadsRef.current.map((x) => (x.id === id ? { ...x, locked } : x)), [id]);
  }, [apply]);

  // Fase Lienzos — recalcula la geometría de TODOS los lienzos con plantilla (no
  // "custom" y no bloqueados) tras un cambio global (p. ej. el espacio entre fotos).
  // Las fotos y sus crops se conservan: applyLayout reasigna por orden y mantiene el
  // transform de cada foto.
  const refreshTemplateSpreads = useCallback((album) => {
    const list = spreadsRef.current.map((s) => {
      if (s.locked || !s.layout_id || s.layout_id === "custom") return s;
      const l = getLayout(s.layout_id);
      return l ? applyLayout(s, l, album) : s;
    });
    apply(list, list.map((s) => s.id));
  }, [apply]);

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
          // Al cambiar la geometría del contenedor (mover/resize del hueco o panel de
          // propiedades), la foto se recalcula EN VIVO para volver a cubrirlo (auto
          // cover), conservando el encuadre anterior si sigue siendo válido.
          if ((patch.w_mm != null || patch.h_mm != null) && merged.photo_id) {
            merged.transform = fitTransform(merged);
          }
          return merged;
        }),
      };
    });
    apply(list, [spreadId], history);
  }, [apply]);

  const selectSlot = useCallback((slotId) => {
    setSelectedSlotId(slotId);
    if (slotId) setSlotMode("photo");
  }, []);
  const selectSlotContainer = useCallback((slotId) => {
    setSelectedSlotId(slotId);
    if (slotId) setSlotMode("container");
  }, []);

  // freshTransform = AJUSTE INICIAL AUTOMÁTICO al entrar la foto en el contenedor:
  // auto cover centrado (escala 1, sin offsets): cubre todo, sin deformar, centrado.
  const assignPhotoToSlot = useCallback((spreadId, slotId, photoId) => {
    updateSlot(spreadId, slotId, { photo_id: photoId, transform: freshTransform() });
    selectSlot(slotId);
  }, [updateSlot, selectSlot]);

  const removePhotoFromSlot = useCallback((spreadId, slotId) => {
    updateSlot(spreadId, slotId, { photo_id: null, transform: freshTransform() });
  }, [updateSlot]);

  const movePhotoBetweenSlots = useCallback((spreadId, fromSlotId, toSlotId) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    if (!s) return;
    const from = (s.slots || []).find((x) => x.slot_id === fromSlotId);
    const to = (s.slots || []).find((x) => x.slot_id === toSlotId);
    if (!from || !to) return;
    const list = spreadsRef.current.map((x) => {
      if (x.id !== spreadId) return x;
      return {
        ...x,
        slots: x.slots.map((sl) =>
          sl.slot_id === fromSlotId ? { ...sl, photo_id: to.photo_id, transform: freshTransform() }
            : sl.slot_id === toSlotId ? { ...sl, photo_id: from.photo_id, transform: freshTransform() }
            : sl
        ),
      };
    });
    apply(list, [spreadId]);
  }, [apply]);

  const addSlotWithPhoto = useCallback((spreadId, photoId) => {
    const s = spreadsRef.current.find((x) => x.id === spreadId);
    if (!s) return;
    const slot = makeCustomSlot(project, photoId);
    apply(spreadsRef.current.map((x) => (x.id === spreadId ? { ...x, layout_id: x.layout_id || "custom", slots: [...(x.slots || []), slot] } : x)), [spreadId]);
    setSelectedSlotId(slot.slot_id);
  }, [apply, project]);

  const removeSlot = useCallback((spreadId, slotId) => {
    apply(spreadsRef.current.map((x) => (x.id !== spreadId ? x : { ...x, slots: (x.slots || []).filter((sl) => sl.slot_id !== slotId) })), [spreadId]);
    setSelectedSlotId(null);
  }, [apply]);

  // Gesturas (pan/zoom/resize): una sola entrada de historial por gesto.
  const gestureBegin = useCallback(() => pushHistory(), [pushHistory]);

  // ---- Undo / Redo (solo el documento de este álbum) ----
  const restore = useCallback((snap) => {
    const current = spreadsRef.current;
    const restored = snap.map((s) => {
      const rid = remapRef.current.get(s.id);
      return rid ? { ...s, id: rid } : s;
    });
    current.forEach((s) => {
      if (!restored.some((r) => r.id === s.id) && !String(s.id).startsWith("tmp_")) deletedRef.current.add(s.id);
      dirtyRef.current.delete(s.id);
    });
    restored.forEach((s) => { if (!deletedRef.current.has(s.id)) dirtyRef.current.set(s.id, s); });
    setSpreads(restored);
    setSelectedSpreadId((cur) => (restored.some((r) => r.id === cur) ? cur : restored.length ? restored[0].id : null));
    setSelectedSlotId(null);
    scheduleSave();
  }, [scheduleSave]);

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
    selectSpread: setSelectedSpreadId, selectSlot, selectSlotContainer,
    addSpread, deleteSpreadById, duplicateSpreadById, moveSpread, reorderSpreads,
    setSpreadLayoutById, setLocked, refreshTemplateSpreads,
    updateSlot, assignPhotoToSlot, removePhotoFromSlot, movePhotoBetweenSlots,
    addSlotWithPhoto, removeSlot, gestureBegin,
    undo, redo, canUndo: hist.canUndo, canRedo: hist.canRedo, saving, saveError, retrySave: flush, flush,
  };
}