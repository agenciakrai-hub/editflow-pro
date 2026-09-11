import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

// Vista previa a pantalla completa (modo revisión): foto grande al centro, contador
// de totales/seleccionadas arriba y tira de miniaturas abajo. ⌘/Ctrl+clic sobre la
// foto grande o una miniatura: foto en revisión → validada (verde); foto verde →
// desmarcada; sin marcar → marcada. La selección es la MISMA del espacio de trabajo,
// así que al cerrar la vista previa la galería refleja lo hecho aquí (y viceversa).
// Flechas ←/→ navegan, Esc o clic fuera cierra. Verde = seleccionada, amarillo = a
// revisar (marco + punto en la foto grande y en cada miniatura).
export default function PreviewLightbox({ items, index, onIndex, onClose, selectedIds, onToggleSelect, onValidate, onMarkSelected, onMarkReview }) {
  const stripRef = useRef(null);
  // Tamaño de las miniaturas de la tira inferior, ajustable con la barra.
  const [thumbH, setThumbH] = useState(80);
  // Preview de ALTA RESOLUCIÓN para el visor grande: muestra el de 800px al instante
  // (ya está en memoria) y, si existe un preview de 2400px, lo precarga y lo
  // sustituye en cuanto está decodificado. El usuario ve la foto al momento y luego
  // la ve nítida sin flash ni parpadeo. Las miniaturas de la tira inferior siguen
  // usando el de 800px (son pequeñas y no necesitan más resolución).
  const currentItem = index != null && index >= 0 && index < items.length ? items[index] : null;
  const [displayUrl, setDisplayUrl] = useState(currentItem?.previewUrl);
  useEffect(() => {
    if (!currentItem) return;
    setDisplayUrl(currentItem.previewUrl);
    if (currentItem.hiResUrl && currentItem.hiResUrl !== currentItem.previewUrl) {
      const img = new Image();
      img.onload = () => setDisplayUrl(currentItem.hiResUrl);
      img.src = currentItem.hiResUrl;
    }
  }, [currentItem?.id, currentItem?.previewUrl, currentItem?.hiResUrl]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndex((i) => (i > 0 ? i - 1 : i));
      else if (e.key === "ArrowRight") onIndex((i) => (i < items.length - 1 ? i + 1 : i));
      else if (e.key === "5" && onMarkSelected) {
        const it = items[index];
        if (it) onMarkSelected(it.id);
      }
      else if (e.key === "3" && onMarkReview) {
        const it = items[index];
        if (it) onMarkReview(it.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onIndex, items, index, onMarkSelected, onMarkReview]);

  // Mantiene la miniatura de la foto actual visible y centrada en la tira.
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-thumb="${index}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  if (index == null || index < 0 || index >= items.length) return null;
  const item = items[index];

  // ⌘/Ctrl+clic: foto en revisión (amarilla) → validada (verde); foto ya verde
  // → se desmarca; foto sin marcar → se marca. Un clic normal solo navega.
  const cmdClick = (it) => {
    if (it.aiReview && onValidate) onValidate(it.id);
    else onToggleSelect(it.id);
  };
  const isCmd = (e) => e.metaKey || e.ctrlKey;

  const handleThumbClick = (e, it, i) => {
    e.stopPropagation();
    if (isCmd(e)) { cmdClick(it); return; }
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
              "relative inline-flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-md border-4 transition-colors " +
              (item.aiReview ? "border-yellow-400" : selectedIds.has(item.id) ? "border-green-500" : "border-transparent")
            }
          >
            {(item.aiReview || selectedIds.has(item.id)) && (
              <span
                className={
                  "absolute right-2 top-2 z-10 h-3.5 w-3.5 rounded-full ring-2 ring-black/50 " +
                  (item.aiReview ? "bg-yellow-400" : "bg-green-500")
                }
                title={item.aiReview ? "A revisar" : "Seleccionada"}
              />
            )}
            <img
              src={displayUrl}
              alt={item.filename}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => { e.stopPropagation(); if (isCmd(e)) cmdClick(item); }}
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

      {/* Instrucción de selección + barra de tamaño de las miniaturas.
          stopPropagation: sin él, arrastrar la barra «Tamaño» burbujea al
          fondo del visor y lo cierra. */}
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 pb-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-center text-xs text-white/70">
          <kbd className="rounded bg-white/15 px-1">5</kbd> verde · <kbd className="rounded bg-white/15 px-1">3</kbd> revisión · ⌘/Ctrl+clic valida · ←/→ navega
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
          // Punto/marco de color: amarillo = a revisar (prevalece), verde = seleccionada.
          const review = !!it.aiReview;
          return (
            <div
              key={it.id}
              data-thumb={i}
              onClick={(e) => handleThumbClick(e, it, i)}
              className={
                "relative shrink-0 cursor-pointer overflow-hidden rounded-md border transition-opacity " +
                (i === index
                  ? review
                    ? "border-yellow-400 ring-2 ring-yellow-400"
                    : marked
                      ? "border-green-500 ring-2 ring-green-500"
                      : "border-white ring-2 ring-white"
                  : review
                    ? "border-yellow-400"
                    : marked
                      ? "border-green-500"
                      : "border-white/10")
              }
              title={it.filename}
            >
              {(review || marked) && (
                <span
                  className={
                    "absolute right-1 top-1 z-10 h-2.5 w-2.5 rounded-full ring-1 ring-black/50 " +
                    (review ? "bg-yellow-400" : "bg-green-500")
                  }
                />
              )}
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