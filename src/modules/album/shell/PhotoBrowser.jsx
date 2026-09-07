import React, { useRef, useState } from "react";
import { FolderOpen, ImageOff, Link2, Loader2, Plus, Search } from "lucide-react";

// Fase 5.2 — Navegador de fotos (franja inferior, ancho completo): filmstrip
// arrastrable de TODO el catálogo importado. `previews` son los THUMBS de nivel 1
// (256 px); los originales jamás se tocan.
export default function PhotoBrowser({ photos, previews, importing, progress, onImportFolder, onImportFiles, onPhotoDoubleClick, onRelocate, relocateCount }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  const list = q ? photos.filter((p) => p.filename.toLowerCase().includes(q.toLowerCase())) : photos;

  return (
    <div className="flex h-36 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <p className="text-xs font-semibold">Fotos <span className="font-normal text-muted-foreground">({photos.length})</span></p>
        <div className="relative ml-2 w-44">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…"
            className="h-7 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-[11px]" />
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
      <div className="flex flex-1 items-stretch gap-2 overflow-x-auto p-2 scrollbar-hide">
        {list.map((p) => (
          <div key={p.id} title={p.filename + (previews.get(p.id) ? "" : " · sin preview local")} draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/album-photo", p.id); e.dataTransfer.effectAllowed = "copy"; }}
            onDoubleClick={() => onPhotoDoubleClick(p.id)}
            className="aspect-square shrink-0 cursor-grab overflow-hidden rounded-lg border border-border bg-secondary">
            {previews.get(p.id) ? (
              <img src={previews.get(p.id)} draggable={false} alt={p.filename} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <ImageOff className="h-4 w-4" />
                {p.preview_status === "unlinked" && <span className="text-[9px] font-medium">desvinculada</span>}
              </div>
            )}
          </div>
        ))}
        {!list.length && (
          <p className="self-center px-2 text-[11px] leading-5 text-muted-foreground">
            Importa la carpeta con las fotos finales exportadas desde Lightroom. Arrastra cualquier foto a un hueco del spread · doble clic la añade al primer hueco libre.
          </p>
        )}
      </div>
    </div>
  );
}