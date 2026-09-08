import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, PanelBottom, PanelLeft, PanelRight, PanelTop } from "lucide-react";
import { getAlbum, listPhotos, listSpreads, listPhotoGroups, addPhotos, updateAlbum, bulkUpdatePhotos } from "@/modules/album/hooks/useAlbumProject";
import { useAlbumStore } from "@/modules/album/manager/albumStore";
import { bestLayoutFor } from "@/modules/album/layout/layoutEngine";
import { getPreview, getTierPreview, previewKey } from "@/modules/album/lib/previewStore";
import { loadHiResPreview } from "@/modules/album/lib/previewService";
import { ingestFiles, filesFromFileList, importFromPickedFolder, cachePhotoPreviews } from "@/modules/album/import/folderImport";
import { saveAlbumFile } from "@/modules/album/format/albumFileIO";
import PhotoBrowser from "@/modules/album/shell/PhotoBrowser";
import ResizeHandle from "@/modules/album/shell/ResizeHandle";
import EditorTopbar from "@/modules/album/shell/EditorTopbar";
import TemplateLibraryPanel from "@/modules/album/shell/TemplateLibraryPanel";
import SpreadNavigator from "@/modules/album/shell/SpreadNavigator";
import SpreadControls from "@/modules/album/shell/SpreadControls";
import PropertiesPanel from "@/modules/album/shell/PropertiesPanel";
import SpreadCanvas from "@/modules/album/editor/SpreadCanvas";
import RelocateDialog from "@/modules/album/relocate/RelocateDialog";
import ExportDialog from "@/modules/album/export/ExportDialog";
import AutoLayoutConfigDialog from "@/modules/album/shell/AutoLayoutConfigDialog";
import { useToast } from "@/components/ui/use-toast";

// Fase 5.2 — SHELL VISUAL profesional del editor: topbar + biblioteca de plantillas
// (izq) + navegador de spreads / lienzo / controles (centro) + propiedades (der) +
// navegador de fotos (abajo). El motor de layouts, la geometría resuelta, las
// transformaciones virtuales, el autosave y el undo/redo NO se tocan.
//
// Fase 3.1 Bloque 4 — en memoria solo viven los THUMBS (256 px, nivel 1) del catálogo;
// la preview de edición (1000 px, nivel 2) se carga bajo demanda por hueco con LRU.
export default function AlbumEditorPage({ projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const project = await getAlbum(projectId);
        const photos = await listPhotos(projectId);
        const spreads = [...(await listSpreads(projectId))].sort((a, b) => a.order_index - b.order_index);
        const photoGroups = await listPhotoGroups(projectId).catch(() => []);
        const thumbs = new Map();
        await Promise.all(photos.map(async (p) => {
          let t = await getTierPreview(projectId, p.id, "thumb");
          if (!t) t = await getPreview(previewKey(projectId, p.filename)); // legado Fase 2
          if (t) thumbs.set(p.id, t);
        }));
        if (alive) setData({ project, photos, spreads, thumbs, photoGroups });
      } catch (e) {
        if (alive) setError(e?.message || "No se pudo cargar el álbum");
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (error) {
    return (
      <div className="space-y-3">
        <Link to="/album" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          <ArrowLeft className="h-3.5 w-3.5" /> Álbumes
        </Link>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando álbum…</div>;
  }
  return <AlbumEditorInner key={projectId} {...data} />;
}

function AlbumEditorInner({ project: initialProject, photos: initialPhotos, spreads, thumbs: initialThumbs, photoGroups }) {
  const { toast } = useToast();
  const [project, setProject] = useState(initialProject);
  const [photos, setPhotos] = useState(initialPhotos);
  const [thumbs, setThumbs] = useState(initialThumbs);
  const [zoomPct, setZoomPct] = useState(100);
  const [guides, setGuides] = useState({ bleed: true, margins: true, safe: false, gutter: true });
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [relocating, setRelocating] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Paneles — visibilidad manual: barra superior, plantillas (izq), propiedades
  // (der) y navegador de fotos (abajo). «Solo lienzo» de la barra los oculta todos
  // para trabajar con el álbum a pantalla completa; cada franja se restaura desde
  // su botón flotante.
  const [panels, setPanels] = useState({ top: true, left: true, right: true, bottom: true });
  const togglePanel = (k) => setPanels((p) => ({ ...p, [k]: !p[k] }));
  const hideAllPanels = () => setPanels({ top: false, left: false, right: false, bottom: false });
  // Altura manual del navegador de lienzos (tira superior del centro) y del
  // navegador de fotos: null = altura natural; al arrastrar el tirador se fija en
  // px (el primer arrastre parte de la altura REAL del panel).
  const [navH, setNavH] = useState(null);
  const [trayH, setTrayH] = useState(null);
  const navWrapRef = useRef(null);
  const trayWrapRef = useRef(null);
  const photosById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  // Similitud entre fotos: grupos de ráfaga/secuencia persistidos por el pipeline
  // de Selección IA (photoId → grupo). Alimenta al planificador DP existente para
  // no colocar fotos casi idénticas en el mismo lienzo ni en lienzos consecutivos.
  const simGroups = useMemo(() => {
    const m = new Map();
    for (const g of photoGroups || []) {
      const ids = g.photo_ids || [];
      if (ids.length < 2) continue;
      for (const id of ids) m.set(id, g.group_index);
    }
    return m;
  }, [photoGroups]);
  const store = useAlbumStore(project, spreads, photosById);

  const spread = store.selectedSpread;
  const selectedSlot = spread ? (spread.slots || []).find((s) => s.slot_id === store.selectedSlotId) || null : null;
  const selectedSlotWithPhoto = selectedSlot
    ? { ...selectedSlot, photo: selectedSlot.photo_id ? photosById.get(selectedSlot.photo_id) : null }
    : null;

  // Bloque 3 — estado local de foto: thumb presente → ok; sin thumb y marcada unlinked
  // → desvinculada; sin thumb → missing (en ESTE dispositivo; el registro no se altera).
  const missingPhotos = photos.filter((p) => !thumbs.has(p.id));

  const refreshThumbs = async (ids) => {
    const next = new Map(thumbs);
    await Promise.all(ids.map(async (id) => {
      const t = await getTierPreview(project.id, id, "thumb");
      if (t) next.set(id, t);
      else next.delete(id);
    }));
    setThumbs(next);
  };

  // Bloque 6 + P1 — ingestión con identidad: crea SOLO fotos nuevas (dedup por nombre
  // Y por content_hash), restaura previews de las existentes, re-enlaza renombradas y
  // rellena la identidad de fotos v1. Los spreads/transformaciones jamás se tocan.
  const applyImport = async ({ newFiles, refreshed }) => {
    const metas = newFiles.map((n) => ({
      project_id: project.id,
      filename: n.file.name,
      relative_path: n.file.webkitRelativePath || n.file.name,
      orientation: n.previews?.orientation || "landscape",
      capture_time: n.file.lastModified || null,
      preview_status: n.previews ? "ok" : "missing",
      ai_state: "unreviewed",
      ...(n.identity?.file_size != null ? { file_size: n.identity.file_size } : {}),
      ...(n.identity?.content_hash ? { content_hash: n.identity.content_hash } : {}),
      ...(n.identity?.phash ? { phash: n.identity.phash } : {}),
      ...(n.identity?.width_px != null ? { width_px: n.identity.width_px } : {}),
      ...(n.identity?.height_px != null ? { height_px: n.identity.height_px } : {}),
    }));
    const created = metas.length ? await addPhotos(metas) : [];
    await Promise.all(created.map((c, i) => cachePhotoPreviews(project.id, c.id, newFiles[i].previews)));

    const updates = [];
    await Promise.all(refreshed.map(async (r) => {
      await cachePhotoPreviews(project.id, r.photo.id, r.previews);
      const patch = {};
      if (r.previews) patch.preview_status = "ok";
      ["file_size", "content_hash", "phash", "width_px", "height_px"].forEach((k) => {
        if (r.identity?.[k] != null) patch[k] = r.identity[k];
      });
      if (r.matchType === "hash" && r.file.name !== r.photo.filename) {
        patch.filename = r.file.name;
        patch.relative_path = r.file.webkitRelativePath || r.file.name;
      }
      if (Object.keys(patch).length) { patch.id = r.photo.id; updates.push(patch); }
    }));
    if (updates.length) { try { await bulkUpdatePhotos(updates); } catch {} }

    const patchById = new Map(updates.map((u) => [u.id, u]));
    setPhotos((prev) => [
      ...prev.map((p) => (patchById.has(p.id) ? { ...p, ...patchById.get(p.id) } : p)),
      ...created,
    ]);
    await refreshThumbs([...created.map((c) => c.id), ...refreshed.map((r) => r.photo.id)]);

    if (created.length && store.spreads.length === 0) {
      setProject((p) => ({ ...p, status: "imported" }));
      updateAlbum(project.id, { status: "imported" }).catch(() => {});
    }
    const restoredCount = updates.filter((u) => u.preview_status === "ok").length;
    if (!created.length && !restoredCount) {
      toast({ title: "Sin cambios", description: "No había fotos nuevas ni previews que restaurar." });
    } else {
      toast({ title: "Importación completa", description: `${created.length} nueva(s) · ${restoredCount} preview(s) restaurada(s).` });
    }
  };

  const importFolder = async () => {
    setImporting(true);
    setProgress(null);
    try {
      const res = await importFromPickedFolder(project.id, photos, (d, t) => setProgress({ d, t }));
      if (res.folderName) {
        setProject((p) => ({ ...p, source_folder_name: res.folderName }));
        updateAlbum(project.id, { source_folder_name: res.folderName }).catch(() => {});
      }
      await applyImport(res);
    } catch (e) {
      if (e?.name !== "AbortError") {
        toast({ title: "No se pudo importar la carpeta", description: e?.message || "Usa el selector de archivos sueltos.", variant: "destructive" });
      }
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const importFiles = async (fileList) => {
    const files = filesFromFileList(fileList);
    if (!files.length) return;
    setImporting(true);
    setProgress(null);
    try {
      const res = await ingestFiles(project.id, files, photos, (d, t) => setProgress({ d, t }));
      await applyImport(res);
    } catch (e) {
      toast({ title: "No se pudo importar", description: e?.message, variant: "destructive" });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  // Bloque 5 — tras la re-localización se refrescan metadatos y thumbs de las fotos
  // afectadas; los spreads no necesitan ningún cambio (referencian photo_id estable).
  const handleRelocated = async (applied) => {
    if (applied?.length) {
      const byId = new Map(applied.map((a) => [a.id, a.patch]));
      setPhotos((prev) => prev.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p)));
      await refreshThumbs(applied.map((a) => a.id));
    }
    setRelocating(false);
  };

  const addPhotoFirstEmpty = (photoId) => {
    if (!spread) return;
    const empty = (spread.slots || []).find((sl) => !sl.photo_id);
    if (empty) store.assignPhotoToSlot(spread.id, empty.slot_id, photoId);
    else store.addSlotWithPhoto(spread.id, photoId);
  };

  // Regla de colocación — arrastrar VARIAS fotos sobre el lienzo actual:
  //   1) Lienzo con huecos VACÍOS → las fotos entran en ESOS huecos (emparejamiento
  //      determinista por proporción y orientación; ajuste FIT o COVER según la
  //      herramienta del lienzo), SIN cambiar la plantilla, sin crear otro lienzo y
  //      sin mover las fotos ya colocadas.
  //   2) Lienzo SIN plantilla ni huecos → selección automática de la plantilla más
  //      compatible con su número y proporciones (determinista, sin IA).
  //   3) Lienzo completo → NADA cambia automáticamente: crear lienzos nuevos es la
  //      acción explícita «Maquetar automáticamente».
  const dropPhotosOnCanvas = async (photoIds) => {
    if (!spread || !Array.isArray(photoIds) || photoIds.length < 2) return;
    if (spread.locked) { toast({ title: "Lienzo bloqueado", description: "Desbloquéalo para colocar fotos." }); return; }
    const objs = photoIds.map((id) => photosById.get(id)).filter(Boolean);
    if (!objs.length) return;

    const emptyCount = (spread.slots || []).filter((sl) => !sl.photo_id).length;
    if (emptyCount > 0) {
      const res = await store.fillEmptySlotsWithPhotos(spread.id, photoIds);
      if (res) {
        toast({
          title: res.unplaced > 0 ? "Huecos insuficientes" : "Fotos añadidas a la plantilla",
          description: res.unplaced > 0
            ? `${res.placed} colocada(s) en los huecos vacíos · ${res.unplaced} sin espacio en este lienzo (quedan sin colocar). Usa «Maquetar automáticamente» para lienzos nuevos.`
            : `${res.placed} foto(s) en los contenedores vacíos de la plantilla actual, sin cambiarla (⌘Z deshace).`,
        });
        return;
      }
    }

    if ((spread.slots || []).length === 0) {
      const pick = bestLayoutFor(project, objs);
      if (!pick) {
        toast({ title: "Sin plantilla compatible", description: `No hay plantilla para ${objs.length} fotos en un lienzo; suelta menos fotos o repártelas en varios lienzos.`, variant: "destructive" });
        return;
      }
      store.applyAutoLayout(spread.id, pick.layout.id, pick.assignment);
      toast({ title: "Plantilla aplicada automáticamente", description: `${objs.length} foto(s) colocadas en «${pick.layout.id}», completas y sin recorte.` });
      return;
    }

    toast({ title: "El lienzo no tiene huecos libres", description: "Todas sus fotos ya están colocadas. Usa «Maquetar automáticamente» para crear lienzos nuevos." });
  };

  // Fase Lienzos — configuración global del álbum (fondo + espacio entre fotos).
  // El cambio de espacio recalcula la geometría de los lienzos con plantilla.
  const updateAlbumConfig = (patch) => {
    const next = { ...project, ...patch };
    setProject(next);
    updateAlbum(project.id, patch).catch(() => {});
    if (patch.photo_gap_mm != null) store.refreshTemplateSpreads(next);
  };

  // Fotos colocadas en algún hueco de algún lienzo (para el filtro "Sin colocar").
  const placedPhotoIds = useMemo(() => {
    const set = new Set();
    store.spreads.forEach((s) => (s.slots || []).forEach((sl) => { if (sl.photo_id) set.add(sl.photo_id); }));
    return set;
  }, [store.spreads]);

  // ---- Fase 1 — MAQUETACIÓN AUTOMÁTICA DETERMINISTA (sin IA) ----
  // Recibe ids de fotos (selección múltiple o una carpeta) y los ORDENA por el
  // orden ESTABLE del catálogo (orden de importación mostrado: nunca se mezclan ni
  // se ordena aleatoriamente). El store calcula el plan completo (DP, no greedy) y
  // crea los lienzos nuevos DESPUÉS del último existente como UNA operación atómica
  // (⌘Z deshace toda la maquetación). Desde una carpeta solo se usan fotos SIN
  // COLOCAR; las ya utilizadas permanecen intactas. El editor salta al primer
  // lienzo nuevo para revisarlo.
  const runAutoLayout = async (ids, cfg = {}) => {
    const idSet = new Set(ids);
    const ordered = photos.filter((p) => idSet.has(p.id)).map((p) => p.id);
    if (!ordered.length) {
      toast({ title: "Nada que maquetar", description: "Selecciona fotos o una carpeta con fotos sin colocar." });
      return;
    }
    const limit = Number(cfg.maxSpreads) > 0 ? Math.floor(Number(cfg.maxSpreads)) : null;
    toast({ title: "Maquetando…", description: limit ? `Preparando la distribución automática (máximo ${limit} lienzos).` : "Preparando la distribución automática de las fotos." });
    const res = await store.autoLayoutPhotos(ordered, { maxSpreads: limit, simGroups, priority: cfg.priority, maxPerSpread: cfg.maxPerSpread });
    if (!res) {
      toast({ title: "Sin plantillas compatibles", description: "No hay combinación de plantillas para estas fotos dentro del máximo de lienzos indicado y la configuración actual del álbum.", variant: "destructive" });
      return;
    }
    toast({
      title: "Maquetación completada",
      description: `${res.total} seleccionada(s) · ${res.placed} colocada(s) · ${res.leftover} sin colocar · ${res.spreadCount} lienzo(s) creado(s) al final del álbum${res.usedAi ? " · con mejora visual IA" : ""}. Revisa los lienzos nuevos (⌘Z deshace toda la maquetación).`,
    });
  };
  const handleAutoLayoutFolder = (folder) => {
    const ids = photos.filter((p) => p.folder === folder && !placedPhotoIds.has(p.id)).map((p) => p.id);
    setAutoDialog({ mode: "create", ids });
  };
  // Configuración antes de maquetar (punto 14) — el diálogo pide límite de lienzos,
  // fotos por lienzo y prioridad; luego ejecuta la maquetación o la regeneración
  // selectiva (punto 13). Los lienzos bloqueados siempre se respetan (punto 11/12).
  const [autoDialog, setAutoDialog] = useState(null);
  const openAutoLayout = (ids) => setAutoDialog({ mode: "create", ids });
  const openRegenerateNonLocked = () => {
    const ids = [];
    store.spreads.filter((s) => !s.locked).forEach((s) => (s.slots || []).forEach((sl) => { if (sl.photo_id) ids.push(sl.photo_id); }));
    if (!ids.length) { toast({ title: "Nada que regenerar", description: "No hay lienzos no bloqueados con fotos colocadas." }); return; }
    setAutoDialog({ mode: "regenerate", ids });
  };
  const confirmAutoDialog = async (cfg) => {
    const d = autoDialog;
    setAutoDialog(null);
    if (!d) return;
    if (d.mode === "regenerate") {
      toast({ title: "Regenerando…", description: "Rehaciendo los lienzos no bloqueados (los bloqueados quedan intactos)." });
      const res = await store.regenerateNonLocked({ maxSpreads: cfg.maxSpreads, maxPerSpread: cfg.maxPerSpread, priority: cfg.priority, simGroups });
      if (!res) { toast({ title: "Sin plantillas compatibles", description: "No hay combinación para regenerar con esa configuración.", variant: "destructive" }); return; }
      toast({ title: "Regeneración completada", description: `${res.placed} foto(s) en ${res.spreadCount} lienzo(s) nuevo(s) · ${res.keptLocked} bloqueado(s) intacto(s) · ${res.leftover} sin colocar (⌘Z deshace).` });
      return;
    }
    runAutoLayout(d.ids, cfg);
  };

  // Fase Carpetas — organización VIRTUAL de fotos: la lista de nombres vive en el
  // proyecto (photo_folders) y cada foto guarda su carpeta en 'folder'. Nunca se
  // tocan los archivos originales.
  const handleCreateFolder = (name) => {
    setProject((p) => ({ ...p, photo_folders: [...(p.photo_folders || []), name] }));
    updateAlbum(project.id, { photo_folders: [...(project.photo_folders || []), name] }).catch(() => {});
  };
  const handleMovePhotos = async (ids, folder) => {
    try {
      await bulkUpdatePhotos(ids.map((id) => ({ id, folder })));
    } catch (e) {
      toast({ title: "No se pudo mover a la carpeta", description: e?.message, variant: "destructive" });
      return;
    }
    const idSet = new Set(ids);
    setPhotos((prev) => prev.map((p) => (idSet.has(p.id) ? { ...p, folder } : p)));
  };

  // ---- Fase A/B — guardado del ARCHIVO del proyecto (⌘+S) ----
  // ⌘+S guarda el .editflowalbum en la ruta VINCULADA (o abre el selector la primera
  // vez y la vincula). El autosave interno de la base de datos sigue funcionando de
  // forma independiente: este guardado es solo el archivo real del proyecto.
  const [savingFile, setSavingFile] = useState(false);
  const saveProjectFile = async () => {
    if (savingFile) return;
    setSavingFile(true);
    try {
      const res = await saveAlbumFile(project, photos, store.spreads);
      if (res?.mode === "linked") toast({ title: "Álbum guardado", description: "Guardado en la ruta vinculada." });
      else if (res?.mode === "picked") toast({ title: "Álbum guardado", description: "Ruta vinculada: ⌘+S guardará directamente aquí la próxima vez." });
      else if (res?.mode === "download") toast({ title: "Archivo descargado", description: "Tu navegador no permite guardar en ruta: se descargó el .editflowalbum." });
    } catch (e) {
      toast({ title: "No se pudo guardar el archivo", description: e?.message, variant: "destructive" });
    } finally {
      setSavingFile(false);
    }
  };

  // ---- Fase A — atajos de teclado profesionales ----
  // ⌘/Ctrl+Z = un paso atrás, ⌘/Ctrl+Shift+Z = rehacer, ⌘/Ctrl+S = guardar archivo.
  // Reutilizan el sistema undo/redo y el guardado EXISTENTES del editor (nada paralelo)
  // y no actúan mientras se escribe en un input/textarea.
  const shortcutsRef = useRef({});
  shortcutsRef.current = { undo: store.undo, redo: store.redo, save: saveProjectFile };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) shortcutsRef.current.redo?.();
        else shortcutsRef.current.undo?.();
      } else if (k === "s") {
        e.preventDefault();
        shortcutsRef.current.save?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const spreadId = spread?.id;
  const locked = !!spread?.locked;
  const slotHandlers = useMemo(() => {
    if (!spreadId || locked) return {};
    return {
      onPan: (slotId, x, y) => store.updateSlot(spreadId, slotId, { transform: { offset_x_mm: x, offset_y_mm: y } }, false),
      onZoomPhoto: (slotId, factor) => store.zoomSlotPhoto(spreadId, slotId, factor),
      onMoveSlot: (slotId, x, y) => store.updateSlot(spreadId, slotId, { x_mm: Math.round(x), y_mm: Math.round(y) }, false),
      onResizeSlot: (slotId, w, h) => store.updateSlot(spreadId, slotId, { w_mm: Math.max(15, Math.round(w)), h_mm: Math.max(15, Math.round(h)) }, false),
      // Mano negra — redimensionado desde CUALQUIER lado/esquina (x,y,w,h juntos:
      // el lado opuesto queda anclado) y conmutación del modo por doble clic.
      onBoxSlot: (slotId, box) => store.updateSlot(spreadId, slotId, {
        x_mm: Math.round(box.x), y_mm: Math.round(box.y),
        w_mm: Math.max(15, Math.round(box.w)), h_mm: Math.max(15, Math.round(box.h)),
      }, false),
      onToggleContainerMode: (slotId) => store.toggleSlotContainerMode(slotId),
      onDropPhoto: (slotId, photoId) => store.assignPhotoToSlot(spreadId, slotId, photoId),
      onSlotDrop: (slotId, fromSlotId) => store.movePhotoBetweenSlots(spreadId, fromSlotId, slotId),
      onGestureBegin: () => store.gestureBegin(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadId, locked]);

  const spreadIndex = store.spreads.findIndex((s) => s.id === spread?.id);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[620px] flex-col gap-2">
      {!panels.top && (
        <button onClick={() => togglePanel("top")} title="Mostrar barra superior"
          className="flex h-7 w-fit shrink-0 items-center gap-1.5 self-start rounded-lg border border-border bg-card px-3 text-[10px] font-medium hover:bg-secondary">
          <PanelTop className="h-3.5 w-3.5" /> Barra superior
        </button>
      )}
      {panels.top && (
        <>
        <EditorTopbar
          panels={panels}
          onTogglePanel={togglePanel}
          onHideAllPanels={hideAllPanels}
          album={project}
        saving={store.saving || savingFile}
        canUndo={store.canUndo} canRedo={store.canRedo}
        onUndo={store.undo} onRedo={store.redo}
        zoomPct={zoomPct}
        onZoom={(d) => setZoomPct((z) => Math.min(400, Math.max(25, z + d)))}
        onFit={() => setZoomPct(100)}
        guides={guides}
        onToggleGuide={(k, v) => setGuides((g) => ({ ...g, [k]: v }))}
        onDownload={saveProjectFile}
        onExport={() => setExporting(true)}
        fillPhotos={!!spread?.fill_photos}
        fillDisabled={!spread || !!spread.locked}
        onToggleFillPhotos={() => store.setSpreadFill(spread.id, !spread.fill_photos)}
        canvasFill={!!spread?.fill_canvas}
        canvasFillDisabled={!spread || !!spread.locked || !spread.layout_id || spread.layout_id === "custom" || !(spread.slots || []).length}
        onToggleCanvasFill={() => store.setSpreadCanvasFill(spread.id, !spread.fill_canvas)}
        />
        </>
      )}

      {store.saveError && (
        <div className="flex shrink-0 items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{store.saveError}</span>
          <button onClick={() => store.retrySave()} className="ml-auto shrink-0 rounded-lg border border-destructive/50 px-2.5 py-1 font-semibold hover:bg-destructive/20">
            Reintentar guardado
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2">
        {panels.left && (
          <TemplateLibraryPanel
            album={project}
            spread={spread}
            onApplyLayout={(layoutId) => spreadId && store.setSpreadLayoutById(spreadId, layoutId)}
          />
        )}
        {!panels.left && (
          <button onClick={() => togglePanel("left")} title="Mostrar plantillas"
            className="flex h-16 w-7 shrink-0 items-center justify-center self-center rounded-lg border border-border bg-card hover:bg-secondary">
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div ref={navWrapRef} style={navH ? { height: navH } : undefined} className="shrink-0 overflow-hidden">
          <SpreadNavigator
            height={navH}
            album={project}
            spreads={store.spreads}
            selectedId={store.selectedSpreadId}
            thumbs={thumbs}
            onSelect={store.selectSpread}
            onAdd={() => store.addSpread()}
            onDuplicate={store.duplicateSpreadById}
            onDelete={store.deleteSpreadById}
            onReorder={store.reorderSpreads}
          />
          </div>
          <ResizeHandle targetRef={navWrapRef} onChange={setNavH} min={72} max={360}
            label="Arrastra para ajustar la altura del navegador de lienzos" />
          {spread ? (
            <SpreadCanvas
              album={project}
              spread={spread}
              photosById={photosById}
              zoomPct={zoomPct}
              guides={guides}
              selectedSlotId={store.selectedSlotId}
              locked={locked}
              slotMode={store.slotMode}
              onSelectSlot={store.selectSlot}
              onSelectSlotContainer={store.selectSlotContainer}
              onDropPhotoOnCanvas={(photoId) => store.addSlotWithPhoto(spread.id, photoId)}
              onDropPhotosOnCanvas={dropPhotosOnCanvas}
              handlers={slotHandlers}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              Crea tu primer lienzo para empezar a maquetar el álbum.
            </div>
          )}
          <SpreadControls
            index={spreadIndex}
            total={store.spreads.length}
            hasSpread={!!spread}
            locked={locked}
            onPrev={() => {
              if (spreadIndex > 0) { store.selectSpread(store.spreads[spreadIndex - 1].id); store.selectSlot(null); }
            }}
            onNext={() => {
              if (spreadIndex >= 0 && spreadIndex < store.spreads.length - 1) { store.selectSpread(store.spreads[spreadIndex + 1].id); store.selectSlot(null); }
            }}
            onAdd={() => store.addSpread()}
            onDuplicate={() => store.duplicateSpreadById(spreadId)}
            onDelete={() => store.deleteSpreadById(spreadId)}
            onMoveLeft={() => store.moveSpread(spreadId, -1)}
            onMoveRight={() => store.moveSpread(spreadId, 1)}
            onToggleLock={() => store.setLocked(spreadId, !locked)}
            onRegenerate={() => store.regenerateSpread(spreadId).then((r) => {
              if (!r) return;
              toast({ title: "Lienzo regenerado", description: `Plantilla reelegida para ${r.count} foto(s) (⌘Z deshace).` });
            })}
          />
        </div>

        {panels.right && (
          <PropertiesPanel
            album={project}
            spread={spread}
            onAlbumConfig={updateAlbumConfig}
            selectedSlot={selectedSlotWithPhoto}
            onToggleLock={() => store.setLocked(spreadId, !locked)}
            onSlotProp={(patch) => store.updateSlot(spreadId, selectedSlot.slot_id, patch)}
            onRemovePhoto={() => store.removePhotoFromSlot(spreadId, selectedSlot.slot_id)}
            onRemoveSlot={() => store.removeSlot(spreadId, selectedSlot.slot_id)}
          />
        )}
        {!panels.right && (
          <button onClick={() => togglePanel("right")} title="Mostrar propiedades"
            className="flex h-16 w-7 shrink-0 items-center justify-center self-center rounded-lg border border-border bg-card hover:bg-secondary">
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!panels.bottom && (
        <button onClick={() => togglePanel("bottom")} title="Mostrar fotos"
          className="mx-auto flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[10px] font-medium hover:bg-secondary">
          <PanelBottom className="h-3.5 w-3.5" /> Fotos
        </button>
      )}
      {panels.bottom && (
        <>
        <ResizeHandle targetRef={trayWrapRef} onChange={setTrayH} min={80} max={440}
          label="Arrastra para ajustar la altura del navegador de fotos" />
        <div ref={trayWrapRef} style={trayH ? { height: trayH } : undefined} className="shrink-0 overflow-hidden">
        <PhotoBrowser
          photos={photos}
          defaultMaxSpreads={project.spread_count_target}
          height={trayH}
        previews={thumbs}
        placedPhotoIds={placedPhotoIds}
        folders={project.photo_folders || []}
        getPhotoPreview={(id) => getTierPreview(project.id, id, "preview")}
        loadHiRes={(photo) => loadHiResPreview(project.id, photo.id, photo.filename, photo, 2400)}
        onCreateFolder={handleCreateFolder}
        onMovePhotos={handleMovePhotos}
        onAddToCanvas={addPhotoFirstEmpty}
        importing={importing}
        progress={progress}
        onImportFolder={importFolder}
        onImportFiles={importFiles}
        onRelocate={() => setRelocating(true)}
        relocateCount={missingPhotos.length}
        onAutoLayout={openAutoLayout}
        onAutoLayoutFolder={handleAutoLayoutFolder}
        onRegenerateNonLocked={openRegenerateNonLocked}
        />
        </div>
        </>
      )}

      {autoDialog && (
        <AutoLayoutConfigDialog
          open
          defaults={{ maxSpreads: project.spread_count_target || 20, maxPerSpread: project.max_photos_per_spread || 6, priority: "balanced" }}
          onConfirm={confirmAutoDialog}
          onClose={() => setAutoDialog(null)}
        />
      )}
      {exporting && (
        <ExportDialog
          album={project}
          spreads={store.spreads}
          photosById={photosById}
          onClose={() => setExporting(false)}
        />
      )}

      {relocating && (
        <RelocateDialog
          projectId={project.id}
          photos={missingPhotos}
          onClose={() => setRelocating(false)}
          onApplied={handleRelocated}
        />
      )}
    </div>
  );
}