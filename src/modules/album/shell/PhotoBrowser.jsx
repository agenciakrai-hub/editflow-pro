import React, { useMemo, useRef, useState } from "react";
import { FolderOpen, Link2, Loader2, Plus, Search, Wand2, X } from "lucide-react";
import FolderTabs from "@/modules/album/shell/photoBrowser/FolderTabs";
import ThumbStrip from "@/modules/album/shell/photoBrowser/ThumbStrip";
import PhotoZoom from "@/modules/album/shell/photoBrowser/PhotoZoom";

const ALL = "__all__";

// Fase Carpetas — navegador de fotos del editor. Organización VIRTUAL por carpetas
// (etiqueta 'folder' por foto + lista de nombres en el proyecto): los archivos
// originales nunca se mueven ni duplican.
//
// Colocación múltiple — selección con clic (individual), Ctrl/Cmd+clic (alternar) y
// Shift+clic (rango), con estado visual claro (anillo + check). Arrastrar la selección
// al lienzo crea automáticamente la plantilla adecuada. Doble clic = ampliada.
export default function PhotoBrowser({ photos, previews, placedPhotoIds, folders = [], getPhotoPreview, loadHiRes, onCreateFolder, onMovePhotos, onAddToCanvas, importing, progress, onImportFolder, onImportFiles, onRelocate, relocateCount, onAutoLayout, onAutoLayoutFolder }) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState(ALL);
  const [onlyUnplaced, setOnlyUnplaced] = useState(false);
  const [thumbSize, setThumbSize] = useState(96);
  const [zoomIndex, setZoomIndex] = useState(null);
  const [selIds, setSelIds] = useState(() => new Set());
  const anchorRef = useRef(null);
  const inputRef = useRef(null);

  const matchesQ = (p) => !q || p.filename.toLowerCase().includes(q.toLowerCase());
  // La carpeta seleccionada filtra la lista; "Sin colocar" se aplica dentro de ella.
  const list = photos.filter((p) =>
    (folder === ALL || p.folder === folder) &&
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

  const handlePhotoClick = (e, p, idx) => {
    if (e.shiftKey && anchorRef.current != null) {
      const a = Math.min(anchorRef.current, idx);
      const b = Math.max(anchorRef.current, idx);
      setSelIds(new Set(list.slice(a, b + 1).map((x) => x.id)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelIds((prev) => {
        const n = new Set(prev);
        if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
        return n;
      });
      anchorRef.current = idx;
      return;
    }
    setSelIds(new Set([p.id]));
    anchorRef.current = idx;
  };
  const openZoom = (p) => setZoomIndex(list.findIndex((x) => x.id === p.id));
  const clearSelection = () => { setSelIds(new Set()); anchorRef.current = null; };

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
        {selIds.size > 0 && (
          <button onClick={clearSelection} title="Arrastra la selección al lienzo para crear la plantilla automática"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {selIds.size} seleccionada{selIds.size !== 1 ? "s" : ""} <X className="h-2.5 w-2.5" />
          </button>
        )}
        {selIds.size > 0 && onAutoLayout && (
          <button onClick={() => onAutoLayout([...selIds])}
            title="Crea lienzos nuevos al final del álbum, elige las plantillas más compatibles y distribuye las fotos (⌘Z deshace toda la maquetación)"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90">
            <Wand2 className="h-3 w-3" /> Maquetar automáticamente ({selIds.size})
          </button>
        )}
        {folder !== ALL && onAutoLayoutFolder && (
          <button onClick={() => onAutoLayoutFolder(folder)}
            title={`Maqueta automáticamente las fotos SIN COLOCAR de «${folder}» en lienzos nuevos al final del álbum`}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/20">
            <Wand2 className="h-3 w-3" /> Maquetar carpeta
          </button>
        )}
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
          placedPhotoIds={placedPhotoIds} selectedIds={selIds}
          onPhotoClick={handlePhotoClick} onPhotoDoubleClick={openZoom}
          emptyHint="Importa la carpeta con las fotos finales exportadas desde Lightroom. Clic selecciona (Ctrl/Cmd y Shift para varias) · doble clic amplía · arrastra la selección al lienzo y la plantilla se crea automáticamente." />
      </div>

      {zoomIndex != null && list[zoomIndex] && (
        <PhotoZoom photos={list} index={zoomIndex} thumbs={previews}
          getPhotoPreview={getPhotoPreview} loadHiRes={loadHiRes} folders={folders}
          onMoveFolder={onMovePhotos} onAddToCanvas={onAddToCanvas}
          onClose={() => setZoomIndex(null)} onIndex={setZoomIndex} />
      )}
    </div>
  );
}