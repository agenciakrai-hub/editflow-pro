import React, { useRef, useState } from "react";
import { FolderOpen, ImageOff, Loader2, Search } from "lucide-react";

// Panel izquierdo del editor (wireframe E): catálogo COMPLETO de fotos importadas.
// Las previews son copias reducidas locales; los originales nunca se tocan.
export default function PhotoPanel({ photos, previews, importing, progress, onImportFolder, onImportFiles, onPhotoDoubleClick }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  const list = q ? photos.filter((p) => p.filename.toLowerCase().includes(q.toLowerCase())) : photos;

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Fotos ({photos.length})</p>
        </div>
        <button onClick={onImportFolder} disabled={importing}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          {importing ? (progress ? `Importando ${progress.d}/${progress.t}` : "Importando…") : "Importar carpeta"}
        </button>
        <button onClick={() => inputRef.current?.click()} disabled={importing}
          className="w-full rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary disabled:opacity-40">
          o elegir archivos sueltos
        </button>
        <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png" className="hidden"
          onChange={(e) => { onImportFiles(e.target.files); e.target.value = ""; }} />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-xs" />
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-3">
        {list.map((p) => (
          <div key={p.id} title={p.filename} draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/album-photo", p.id); e.dataTransfer.effectAllowed = "copy"; }}
            onDoubleClick={() => onPhotoDoubleClick(p.id)}
            className="aspect-square cursor-grab overflow-hidden rounded-lg border border-border bg-secondary">
            {previews.get(p.id) ? (
              <img src={previews.get(p.id)} draggable={false} alt={p.filename} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageOff className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        {!list.length && (
          <p className="col-span-2 text-xs leading-5 text-muted-foreground">
            Importa la carpeta con las fotos finales exportadas desde Lightroom. Arrastra cualquier foto a un hueco del spread.
          </p>
        )}
      </div>
    </aside>
  );
}