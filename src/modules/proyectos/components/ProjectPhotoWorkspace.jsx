import { useState } from "react";
import { CheckSquare, Square, Trash2, Save, Sparkles, Wand2, Loader2, BookOpen } from "lucide-react";
import { STATUS_LABEL, STATUS_COLOR } from "./PhotoFingerprintGrid";
import Lightbox from "@/components/Lightbox";

// Espacio de trabajo a pantalla completa para las fotos subidas al proyecto.
// Reemplaza al PhotoFingerprintGrid + botón Guardar sueltos. Incluye:
//  - Grid que ocupa todo el ancho disponible.
//  - Imágenes verticales en su proporción real (object-contain, sin recorte).
//  - Slider para aumentar/disminuir el tamaño de las cuadrículas (nº de columnas).
//  - Selección múltiple (Seleccionar todas / individual) + botón Eliminar.
//  - Barra lateral derecha con Guardar, Selección y Editar (con sus rutas).
export default function ProjectPhotoWorkspace({
  items, selectedIds, onToggleSelect, onToggleSelectAll, onDeleteSelected,
  onCycleStatus, gridCols, onGridCols, saving, onSave, onGoSeleccion, onGoEditar, onGoAlbum,
}) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const cols = Math.max(2, Math.min(12, gridCols));
  // Slider invertido: separar el control de "Tamaño" (izquierda) aumenta el tamaño
  // de las fotos → menos columnas. valor alto del slider = menos columnas = más grande.
  const MIN = 2, MAX = 12;
  const sliderValue = MIN + MAX - cols;
  const images = items.map((it) => ({ url: it.previewUrl, filename: it.filename }));

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Grid a pantalla completa */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <button
            type="button"
            onClick={onToggleSelectAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            {allSelected ? <CheckSquare className="h-3.5 w-3.5 text-accent" /> : <Square className="h-3.5 w-3.5" />}
            {allSelected ? "Quitar selección" : "Seleccionar todas"}
          </button>
          <span className="text-xs text-muted-foreground">
            {items.length} fotos · {selectedIds.size} marcadas
          </span>
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={selectedIds.size === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> Eliminar
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Tamaño</span>
            <input
              type="range" min={MIN} max={MAX} value={sliderValue}
              onChange={(e) => onGridCols(MIN + MAX - Number(e.target.value))}
              className="w-32 accent-accent"
            />
          </div>
        </div>

        <div
          className="mt-3 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {items.map((item, i) => {
            const checked = selectedIds.has(item.id);
            return (
              <div key={item.id} className={`relative overflow-hidden rounded-lg border bg-card ${checked ? "border-accent ring-1 ring-accent" : "border-border"}`}>
                <div className="absolute left-1.5 top-1.5 z-10">
                  <button
                    type="button"
                    onClick={() => onToggleSelect(item.id)}
                    className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-accent-foreground" : "border-white/70 bg-black/40 text-transparent hover:bg-black/60"}`}
                  >
                    {checked ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
                  </button>
                </div>
                {item.previewUrl ? (
                  <div
                    className="aspect-square w-full cursor-pointer bg-black/5"
                    onDoubleClick={() => setLightboxIndex(i)}
                  >
                    <img src={item.previewUrl} alt={item.filename} className="h-full w-full object-contain" />
                  </div>
                ) : (
                  <div className="aspect-square w-full bg-muted" />
                )}
                <div className="space-y-1 p-1.5">
                  <p className="truncate text-[10px] font-mono text-muted-foreground">{item.filename}</p>
                  <button
                    type="button"
                    onClick={() => onCycleStatus(item.id)}
                    className={`w-full rounded-md border px-1.5 py-1 text-[10px] font-medium ${STATUS_COLOR[item.status] || ""}`}
                  >
                    {STATUS_LABEL[item.status] || item.status}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Barra lateral derecha con acciones y rutas */}
      <aside className="w-full shrink-0 lg:w-64">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground">Acciones</p>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
          <button
            onClick={onGoSeleccion}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Selección
          </button>
          <button
            onClick={onGoEditar}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Editar
          </button>
          <button
            onClick={onGoAlbum}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            Maquetar álbum
          </button>
          <p className="text-[11px] leading-tight text-muted-foreground">
            «Selección», «Editar» y «Maquetar álbum» guardan el proyecto y abren la herramienta correspondiente.
          </p>
        </div>
      </aside>

      {lightboxIndex != null && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i < images.length - 1 ? i + 1 : i))}
        />
      )}
    </div>
  );
}