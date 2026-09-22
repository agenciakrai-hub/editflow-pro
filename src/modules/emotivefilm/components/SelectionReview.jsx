// Panel de revisión de la selección IA. Muestra todas las fotos seleccionadas
// (de todas las carpetas del proyecto) con controles para fijar, excluir, quitar
// y ampliar. También permite añadir fotos del proyecto que no fueron seleccionadas.
import { useState, useMemo } from "react";
import FilmThumb from "./FilmThumb";
import { Pin, Ban, Plus, Eye, X } from "lucide-react";

export default function SelectionReview({ selection, allPhotos, onTogglePin, onToggleExclude, onRemove, onAdd, onPreview }) {
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("all"); // all | pinned | excluded | couple

  const filtered = useMemo(() => {
    let list = selection;
    if (filter === "pinned") list = list.filter((s) => s.pin);
    if (filter === "excluded") list = list.filter((s) => s.exclude);
    if (filter === "couple") list = list.filter((s) => s.has_couple);
    return list;
  }, [selection, filter]);

  const availableToAdd = useMemo(() => {
    if (!allPhotos) return [];
    const selectedHashes = new Set(selection.map((s) => s.fingerprint_hash));
    return allPhotos.filter((p) => !selectedHashes.has(p.fingerprint_hash));
  }, [allPhotos, selection]);

  const counts = useMemo(() => ({
    total: selection.length,
    pinned: selection.filter((s) => s.pin).length,
    excluded: selection.filter((s) => s.exclude).length,
    couple: selection.filter((s) => s.has_couple).length,
  }), [selection]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{counts.total} fotos seleccionadas</span>
        <div className="flex gap-1">
          {[
            { k: "all", label: "Todas" },
            { k: "pinned", label: `📌 ${counts.pinned}` },
            { k: "couple", label: `💑 ${counts.couple}` },
            { k: "excluded", label: `🚫 ${counts.excluded}` },
          ].map((f) => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (filter === f.k ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/70")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showAdd ? "Cerrar" : "Añadir fotos"}
        </button>
      </div>

      {showAdd && (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Fotos del proyecto no seleccionadas por la IA. Toca para añadir al vídeo.
          </p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {availableToAdd.slice(0, 200).map((p) => (
              <AddThumb key={p.id || p.fingerprint_hash} photo={p} onAdd={() => onAdd(p)} />
            ))}
            {availableToAdd.length > 200 && (
              <p className="col-span-full py-2 text-center text-xs text-muted-foreground">
                Mostrando 200 de {availableToAdd.length}. Usa la búsqueda para más.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {filtered.map((item) => (
          <FilmThumb
            key={item.fingerprint_hash}
            item={item}
            onTogglePin={onTogglePin}
            onToggleExclude={onToggleExclude}
            onRemove={onRemove}
            onPreview={onPreview}
          />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No hay fotos en este filtro.
          </p>
        )}
      </div>
    </div>
  );
}

function AddThumb({ photo, onAdd }) {
  return (
    <button
      onClick={onAdd}
      className="group relative aspect-square overflow-hidden rounded-lg border border-dashed border-border bg-secondary/50 hover:border-accent"
      title={`Añadir ${photo.filename}`}
    >
      <div className="flex h-full w-full items-center justify-center">
        <Plus className="h-5 w-5 text-muted-foreground group-hover:text-accent" />
      </div>
      <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[9px] text-white">
        {photo.filename}
      </span>
    </button>
  );
}