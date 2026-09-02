import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Loader2, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { getAlbum, listPhotos, listSpreads, addPhotos, updateAlbum, markPhotosPreviewOk } from "@/modules/album/hooks/useAlbumProject";
import { useAlbumStore } from "@/modules/album/manager/albumStore";
import { getPreview, previewKey } from "@/modules/album/lib/previewStore";
import { ingestFiles, filesFromFileList, importFromPickedFolder } from "@/modules/album/import/folderImport";
import { downloadAlbumFile } from "@/modules/album/format/albumFile";
import { freshTransform } from "@/modules/album/layout/layoutEngine";
import { albumSizeLabel, STATUS_LABEL } from "@/modules/album/lib/albumUnits";
import PhotoPanel from "@/modules/album/editor/PhotoPanel";
import SpreadCanvas from "@/modules/album/editor/SpreadCanvas";
import SpreadToolbar from "@/modules/album/editor/SpreadToolbar";
import AlbumOverview from "@/modules/album/editor/AlbumOverview";
import LayoutPanel from "@/modules/album/editor/LayoutPanel";
import { useToast } from "@/components/ui/use-toast";

export default function AlbumEditorPage({ projectId }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const project = await getAlbum(projectId);
        const photos = await listPhotos(projectId);
        const spreads = [...(await listSpreads(projectId))].sort((a, b) => a.order_index - b.order_index);
        const previews = new Map();
        for (const p of photos) {
          const url = await getPreview(previewKey(projectId, p.filename));
          if (url) previews.set(p.id, url);
        }
        if (alive) setData({ project, photos, spreads, previews });
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

function AlbumEditorInner({ project: initialProject, photos: initialPhotos, spreads, previews: initialPreviews }) {
  const { toast } = useToast();
  const [project, setProject] = useState(initialProject);
  const [photos, setPhotos] = useState(initialPhotos);
  const [previews, setPreviews] = useState(initialPreviews);
  const [zoomPct, setZoomPct] = useState(100);
  const [guides, setGuides] = useState({ bleed: true, margins: true, safe: false, gutter: true });
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const store = useAlbumStore(project, spreads);

  const spread = store.selectedSpread;
  const photosById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const selectedSlot = spread ? (spread.slots || []).find((s) => s.slot_id === store.selectedSlotId) || null : null;
  const selectedSlotWithPhoto = selectedSlot
    ? { ...selectedSlot, photo: selectedSlot.photo_id ? photosById.get(selectedSlot.photo_id) : null }
    : null;

  // P1 — tras cada importación se refrescan las previews de TODO el catálogo (no solo
  // de las fotos nuevas): re-importar la misma carpeta restaura previews perdidas en
  // otro dispositivo sin duplicar fotos y sin tocar spreads/transformaciones.
  const applyImportedMetas = async (metas) => {
    const created = metas.length ? await addPhotos(metas) : [];
    const catalog = [...photos, ...created];
    const next = new Map(previews);
    const restored = [];
    await Promise.all(catalog.map(async (p) => {
      const url = await getPreview(previewKey(project.id, p.filename));
      if (url) next.set(p.id, url);
      else next.delete(p.id);
      if (url && p.preview_status === "missing") restored.push(p.id);
    }));
    setPreviews(next);
    if (created.length) setPhotos((prev) => [...prev, ...created]);
    if (restored.length) {
      try {
        await markPhotosPreviewOk(restored.map((id) => ({ id, preview_status: "ok" })));
        setPhotos((prev) => prev.map((p) => (restored.includes(p.id) ? { ...p, preview_status: "ok" } : p)));
      } catch {}
    }
    if (created.length && store.spreads.length === 0) {
      setProject((p) => ({ ...p, status: "imported" }));
      updateAlbum(project.id, { status: "imported" }).catch(() => {});
    }
    if (!created.length && !restored.length) {
      toast({ title: "Sin cambios", description: "No había fotos nuevas ni previews que restaurar." });
    } else {
      toast({ title: "Importación completa", description: `${created.length} nueva(s) · ${restored.length} preview(s) restaurada(s).` });
    }
  };

  const importFolder = async () => {
    setImporting(true);
    setProgress(null);
    try {
      const existing = new Set(photos.map((p) => p.filename));
      const res = await importFromPickedFolder(project.id, existing, (d, t) => setProgress({ d, t }));
      if (res.folderName) {
        setProject((p) => ({ ...p, source_folder_name: res.folderName }));
        updateAlbum(project.id, { source_folder_name: res.folderName }).catch(() => {});
      }
      await applyImportedMetas(res.metas);
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
      const existing = new Set(photos.map((p) => p.filename));
      const metas = await ingestFiles(project.id, files, existing, (d, t) => setProgress({ d, t }));
      await applyImportedMetas(metas);
    } catch (e) {
      toast({ title: "No se pudo importar", description: e?.message, variant: "destructive" });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const addPhotoFirstEmpty = (photoId) => {
    if (!spread) return;
    const empty = (spread.slots || []).find((sl) => !sl.photo_id);
    if (empty) store.assignPhotoToSlot(spread.id, empty.slot_id, photoId);
    else store.addSlotWithPhoto(spread.id, photoId);
  };

  const spreadId = spread?.id;
  const locked = !!spread?.locked;
  const slotHandlers = useMemo(() => {
    if (!spreadId || locked) return {};
    return {
      onPan: (slotId, x, y) => store.updateSlot(spreadId, slotId, { transform: { offset_x_mm: x, offset_y_mm: y } }, false),
      onZoomPhoto: (slotId, factor) => {
        const sl = (store.selectedSpread?.slots || []).find((s) => s.slot_id === slotId);
        const next = Math.min(5, Math.max(0.3, (sl?.transform?.scale ?? 1) * factor));
        store.updateSlot(spreadId, slotId, { transform: { scale: Math.round(next * 100) / 100 } }, false);
      },
      onMoveSlot: (slotId, x, y) => store.updateSlot(spreadId, slotId, { x_mm: Math.round(x), y_mm: Math.round(y) }, false),
      onResizeSlot: (slotId, w, h) => store.updateSlot(spreadId, slotId, { w_mm: Math.max(15, Math.round(w)), h_mm: Math.max(15, Math.round(h)) }, false),
      onDropPhoto: (slotId, photoId) => store.assignPhotoToSlot(spreadId, slotId, photoId),
      onSlotDrop: (slotId, fromSlotId) => store.movePhotoBetweenSlots(spreadId, fromSlotId, slotId),
      onGestureBegin: () => store.gestureBegin(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadId, locked]);

  const iconBtn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/album" className={iconBtn}><ArrowLeft className="h-3.5 w-3.5" /> Álbumes</Link>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{project.name}</h1>
          <p className="text-xs text-muted-foreground">
            {albumSizeLabel(project)} · {STATUS_LABEL[project.status] || project.status}
            {project.source_folder_name ? ` · ${project.source_folder_name}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className={"text-xs " + (store.saving ? "animate-pulse text-muted-foreground" : "text-emerald-600")}>
            {store.saving ? "Guardando…" : "Guardado"}
          </span>
          <button className={iconBtn} onClick={store.undo} disabled={!store.canUndo}><Undo2 className="h-3.5 w-3.5" /></button>
          <button className={iconBtn} onClick={store.redo} disabled={!store.canRedo}><Redo2 className="h-3.5 w-3.5" /></button>
          <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs">
            <button title="Alejar" onClick={() => setZoomPct((z) => Math.max(25, z - 25))}><ZoomOut className="h-3.5 w-3.5" /></button>
            <span className="min-w-10 text-center tabular-nums">{zoomPct}%</span>
            <button title="Acercar" onClick={() => setZoomPct((z) => Math.min(400, z + 25))}><ZoomIn className="h-3.5 w-3.5" /></button>
            <button className="font-medium hover:underline" onClick={() => setZoomPct(100)}>Ajustar</button>
          </div>
          <button className={iconBtn} onClick={() => downloadAlbumFile(project, photos, store.spreads)}>
            <Download className="h-3.5 w-3.5" /> .editflowalbum
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5 text-xs">
        <span className="font-medium">Guías</span>
        {[["bleed", "Sangrado"], ["margins", "Márgenes"], ["safe", "Zona segura"], ["gutter", "Gutter"]].map(([k, label]) => (
          <label key={k} className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={guides[k]} onChange={(e) => setGuides((g) => ({ ...g, [k]: e.target.checked }))} />
            {label}
          </label>
        ))}
        <span className="ml-auto text-muted-foreground">Arrastra una foto del panel a un hueco · rueda sobre la foto = zoom · arrastra la foto = recorte virtual</span>
      </div>

      {store.saveError && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{store.saveError}</span>
          <button onClick={() => store.retrySave()} className="ml-auto shrink-0 rounded-lg border border-destructive/50 px-2.5 py-1 font-semibold hover:bg-destructive/20">
            Reintentar guardado
          </button>
        </div>
      )}

      <AlbumOverview
        album={project}
        spreads={store.spreads}
        selectedId={store.selectedSpreadId}
        onSelect={store.selectSpread}
        onAdd={() => store.addSpread()}
        onDuplicate={store.duplicateSpreadById}
        onDelete={store.deleteSpreadById}
        onReorder={store.reorderSpreads}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <PhotoPanel
          photos={photos}
          previews={previews}
          importing={importing}
          progress={progress}
          onImportFolder={importFolder}
          onImportFiles={importFiles}
          onPhotoDoubleClick={addPhotoFirstEmpty}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <SpreadToolbar
            index={store.spreads.findIndex((s) => s.id === spread?.id)}
            total={store.spreads.length}
            hasSpread={!!spread}
            locked={locked}
            onPrev={() => {
              const i = store.spreads.findIndex((s) => s.id === spreadId);
              if (i > 0) { store.selectSpread(store.spreads[i - 1].id); store.selectSlot(null); }
            }}
            onNext={() => {
              const i = store.spreads.findIndex((s) => s.id === spreadId);
              if (i >= 0 && i < store.spreads.length - 1) { store.selectSpread(store.spreads[i + 1].id); store.selectSlot(null); }
            }}
            onAdd={() => store.addSpread()}
            onDuplicate={() => store.duplicateSpreadById(spreadId)}
            onDelete={() => store.deleteSpreadById(spreadId)}
            onMoveLeft={() => store.moveSpread(spreadId, -1)}
            onMoveRight={() => store.moveSpread(spreadId, 1)}
            onToggleLock={() => store.setLocked(spreadId, !locked)}
          />
          {spread ? (
            <SpreadCanvas
              album={project}
              spread={spread}
              photosById={photosById}
              previews={previews}
              zoomPct={zoomPct}
              guides={guides}
              selectedSlotId={store.selectedSlotId}
              locked={locked}
              onSelectSlot={store.selectSlot}
              onDropPhotoOnCanvas={(photoId) => store.addSlotWithPhoto(spread.id, photoId)}
              handlers={slotHandlers}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10 text-sm text-muted-foreground">
              Crea tu primer spread para empezar a maquetar el álbum.
            </div>
          )}
        </div>
        <LayoutPanel
          album={project}
          spread={spread}
          selectedSlot={selectedSlotWithPhoto}
          onApplyLayout={(layoutId) => store.setSpreadLayoutById(spreadId, layoutId)}
          onToggleLock={() => store.setLocked(spreadId, !locked)}
          onSlotProp={(patch) => store.updateSlot(spreadId, selectedSlot.slot_id, patch)}
          onRemovePhoto={() => store.removePhotoFromSlot(spreadId, selectedSlot.slot_id)}
          onRemoveSlot={() => store.removeSlot(spreadId, selectedSlot.slot_id)}
        />
      </div>
    </div>
  );
}