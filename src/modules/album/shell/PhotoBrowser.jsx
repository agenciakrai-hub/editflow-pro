import React, { useMemo, useRef, useState } from "react";
import { FolderOpen, Link2, Loader2, Plus, Search } from "lucide-react";
import FolderTabs from "@/modules/album/shell/photoBrowser/FolderTabs";
import ThumbStrip from "@/modules/album/shell/photoBrowser/ThumbStrip";
import PhotoZoom from "@/modules/album/shell/photoBrowser/PhotoZoom";

// Fase Carpetas — navegador de fotos del editor. Organización VIRTUAL por carpetas
// (etiqueta 'folder' por foto + lista de nombres en el proyecto): los archivos
// originales nunca se mueven ni duplican. Línea 1: carpetas con contadores; línea 2:
// buscador, filtro "Sin colocar" (intacto) y slider de tamaño de miniaturas; área
// principal: tira horizontal navegable de la carpeta seleccionada. Clic en una foto =
// visualización ampliada (no toca crop ni transformaciones); arrastre = hueco de
// lienzo o pestaña de carpeta. Drag & drop, importación y relocalización intactos.
export default function PhotoBrowser({ photos, previews, placedPhotoIds, folders = [], getPhotoPreview, onCreateFolder, onMovePhotos, onAddToCanvas, importing, progress, onImportFolder, onImportFiles, onRelocate, relocateCount }) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("__all__");
  const [onlyUnplaced, setOnlyUnplaced] = useState(false);
  const [thumbSize, setThumbSize] = useState(96);
  const [zoomIndex, setZoomIndex] = useState(null);
  const inputRef = useRef(null);

  const matchesQ = (p) => !q || p.filename.toLowerCase().includes(q.toLowerCase());
  // La carpeta seleccionada filtra la lista; "Sin colocar" se aplica dentro de ella.
  const list = photos.filter((p) =>
    (folder === "__all__" || p.folder === folder) &&
    (!onlyUnplaced || !placedPhotoIds?.has(p.id)) &&
    matchesQ(p)
  );
  const counts = useMemo(() => {
    const m = {};
    photos.forEach((p) => { if (p.folder) m[p.folder] = (m[p.folder] || 0) + 1; });
    return m;
  }, [photos]);

  const createFolder = () => {
    const name = window.prompt("Nombre de la nueva carpeta:", "");
    const trimmed = String(name || "").trim();
    if (!trimmed || folders.includes(trimmed)) return;
    onCreateFolder(trimmed);
  };

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Línea 1 — carpetas de organización */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <p className="shrink-0 text-xs font-semibold">Fotos <span className="font-normal text-muted-foreground">({photos.length})</span></p>
        <div className="min-w-0 flex-1">
          <FolderTabs folders={folders} counts={counts} total={photos.length} active={folder}
            onSelect={setFolder} onCreate={createFolder} onDropPhoto={(id, f) => onMovePhotos([id], f)} />
        </div>
        <button onClick={onImportFolder} disabled={importing}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
          {importing ? (progress ? `Importando ${progress.d}/${progress.t}` : "Importando…") : "Importar carpeta"}
        </button>
        <button onClick={() => inputRef.current?.click()} disabled={importing}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-muted-foreground hover:bg-secondary disabled:opacity-40">
          <Plus className="h-3 w-3" /> Archivos
        </button>
        <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png" className="hidden"
          onChange={(e) => { onImportFiles(e.target.files); e.target.value = ""; }} />
        {relocateCount > 0 && onRelocate && (
          <button onClick={onRelocate} disabled={importing}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-amber-500/60 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-600 hover:bg-amber-500/20 disabled:opacity-40">
            <Link2 className="h-3 w-3" /> Relocalizar ({relocateCount})
          </button>
        )}
      </div>

      {/* Línea 2 — controles de visualización */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-1.5">
        <div className="relative w-44">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…"
            className="h-7 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-[11px]" />
        </div>
        <button onClick={() => setOnlyUnplaced((v) => !v)}
          className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + (onlyUnplaced ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
          Sin colocar ({placedPhotoIds ? photos.length - placedPhotoIds.size : photos.length})
        </button>
        <label className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          Miniaturas
          <input type="range" min="56" max="200" step="4" value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            className="w-28 accent-foreground" />
          <span className="w-9 tabular-nums">{thumbSize}px</span>
        </label>
      </div>

      {/* Área principal — miniaturas de la carpeta seleccionada */}
      <div style={{ height: thumbSize + 24 }}>
        <ThumbStrip photos={list} previews={previews} thumbSize={thumbSize}
          placedPhotoIds={placedPhotoIds}
          onZoom={(p) => setZoomIndex(list.findIndex((x) => x.id === p.id))}
          emptyHint="Importa la carpeta con las fotos finales exportadas desde Lightroom. Arrastra cualquier foto a un hueco del lienzo (o a una pestaña de carpeta) · clic para ampliarla." />
      </div>

      {zoomIndex != null && list[zoomIndex] && (
        <PhotoZoom photos={list} index={zoomIndex} thumbs={previews}
          getPhotoPreview={getPhotoPreview} folders={folders}
          onMoveFolder={onMovePhotos} onAddToCanvas={onAddToCanvas}
          onClose={() => setZoomIndex(null)} onIndex={setZoomIndex} />
      )}
    </div>
  );
}