import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

// Vista previa a pantalla completa (modo revisión): foto grande al centro, contador
// de totales/seleccionadas arriba, instrucción de la tecla ⌘ y tira de miniaturas
// abajo. ⌘/Ctrl+clic sobre una miniatura (o la foto grande) marca/desmarca la foto:
// la selección es la MISMA del espacio de trabajo del proyecto, así que al cerrar la
// vista previa la galería refleja lo marcado aquí (y viceversa). Flechas ←/→ navegan,
// Esc o clic fuera cierra. Todas las fotos se ven iluminadas; las marcadas con ⌘
// lucen un marco verde (en la foto grande y en su miniatura).
export default function PreviewLightbox({ items, index, onIndex, onClose, selectedIds, onToggleSelect }) {
  const stripRef = useRef(null);
  // Tamaño de las miniaturas de la tira inferior, ajustable con la barra.
  const [thumbH, setThumbH] = useState(80);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndex((i) => (i > 0 ? i - 1 : i));
      else if (e.key === "ArrowRight") onIndex((i) => (i < items.length - 1 ? i + 1 : i));
      // Pulsar ⌘/Ctrl (sin clic del ratón) marca la foto grande; pulsarla de nuevo
      // la desmarca. e.repeat evita disparos múltiples al mantener la tecla.
      else if ((e.key === "Meta" || e.key === "Control") && !e.repeat) onToggleSelect(items[index]?.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onIndex, items, index, onToggleSelect]);

  // Mantiene la miniatura de la foto actual visible y centrada en la tira.
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-thumb="${index}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  if (index == null || index < 0 || index >= items.length) return null;
  const item = items[index];

  const handleThumbClick = (e, id, i) => {
    e.stopPropagation();
    onIndex(i);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        title="Cerrar (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Contador de fotos del proyecto y seleccionadas */}
      <p className="shrink-0 pt-4 text-center text-sm font-medium text-white">
        Total de fotos: {items.length} / Fotos Seleccionadas: {selectedIds.size}
      </p>

      {/* Foto grande a tamaño completo */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 py-3">
        {index > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onIndex((i) => i - 1); }}
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            title="Anterior (←)"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
        )}
        {item.previewUrl ? (
          <div
            className={
              "inline-flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-md border-4 transition-colors " +
              (selectedIds.has(item.id) ? "border-green-500" : "border-transparent")
            }
          >
            <img
              src={item.previewUrl}
              alt={item.filename}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <div className="flex h-40 w-64 items-center justify-center rounded-lg bg-white/5 text-xs text-white/50">
            Sin preview
          </div>
        )}
        {index < items.length - 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); onIndex((i) => i + 1); }}
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            title="Siguiente (→)"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        )}
      </div>

      {/* Instrucción de selección + barra de tamaño de las miniaturas */}
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 pb-2">
        <p className="text-center text-xs text-white/70">
          Para seleccionar fotos pulsa la tecla cmd ⌘
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/70">Tamaño</span>
          <input
            type="range"
            min={48}
            max={160}
            value={thumbH}
            onChange={(e) => setThumbH(Number(e.target.value))}
            className="w-32 accent-green-500"
          />
        </div>
      </div>

      {/* Tira de miniaturas: las marcadas luminosas, las desmarcadas atenuadas */}
      <div
        ref={stripRef}
        className="scrollbar-hide flex shrink-0 items-end gap-2 overflow-x-auto px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => {
          const marked = selectedIds.has(it.id);
          return (
            <div
              key={it.id}
              data-thumb={i}
              onClick={(e) => handleThumbClick(e, it.id, i)}
              className={
                "relative shrink-0 cursor-pointer overflow-hidden rounded-md border transition-opacity " +
                (i === index
                  ? marked
                    ? "border-green-500 ring-2 ring-green-500"
                    : "border-white ring-2 ring-white"
                  : marked
                    ? "border-green-500"
                    : "border-white/10")
              }
              title={it.filename}
            >
              {it.previewUrl ? (
                <img
                  src={it.previewUrl}
                  alt={it.filename}
                  style={{ height: thumbH, width: Math.round(thumbH * 1.4) }}
                  className="object-cover"
                />
              ) : (
                <div style={{ height: thumbH, width: Math.round(thumbH * 1.4) }} className="bg-white/10" />
              )}
              <span className="absolute bottom-0.5 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1 text-[10px] text-white">
                {it.filename}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}