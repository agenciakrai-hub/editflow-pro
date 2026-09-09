import { useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

// Vista previa a pantalla completa (modo revisión): foto grande al centro, contador
// de totales/seleccionadas arriba, instrucción de la tecla ⌘ y tira de miniaturas
// abajo. ⌘/Ctrl+clic sobre una miniatura (o la foto grande) marca/desmarca la foto:
// la selección es la MISMA del espacio de trabajo del proyecto, así que al cerrar la
// vista previa la galería refleja lo marcado aquí (y viceversa). Flechas ←/→ navegan,
// Esc o clic fuera cierra. Las fotos marcadas se ven luminosas; las desmarcadas,
// atenuadas (igual que la referencia visual).
export default function PreviewLightbox({ items, index, onIndex, onClose, selectedIds, onToggleSelect }) {
  const stripRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndex((i) => (i > 0 ? i - 1 : i));
      else if (e.key === "ArrowRight") onIndex((i) => (i < items.length - 1 ? i + 1 : i));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onIndex, items.length]);

  // Mantiene la miniatura de la foto actual visible y centrada en la tira.
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-thumb="${index}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  if (index == null || index < 0 || index >= items.length) return null;
  const item = items[index];

  const handleThumbClick = (e, id, i) => {
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      onToggleSelect(id);
    } else {
      onIndex(i);
    }
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
          <img
            src={item.previewUrl}
            alt={item.filename}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => {
              e.stopPropagation();
              if (e.metaKey || e.ctrlKey) onToggleSelect(item.id);
            }}
          />
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

      {/* Instrucción de selección */}
      <p className="shrink-0 pb-2 text-center text-xs text-white/70">
        Para seleccionar fotos pulsa la tecla cmd ⌘
      </p>

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
                  ? "border-white ring-2 ring-white"
                  : marked
                    ? "border-white/40"
                    : "border-white/10")
              }
              title={it.filename}
            >
              {it.previewUrl ? (
                <img src={it.previewUrl} alt={it.filename} className="h-20 w-28 object-cover" />
              ) : (
                <div className="h-20 w-28 bg-white/10" />
              )}
              {/* Atenuado (tono apagado) para las fotos NO marcadas */}
              {!marked && <div className="absolute inset-0 bg-black/55" />}
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