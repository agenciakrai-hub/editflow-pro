import { useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

// Visor a pantalla completa: muestra la foto seleccionada a tamaño máximo y flechas
// para pasar a la anterior/siguiente. Se cierra con Esc o clic fuera. Teclas ←/→ navegan.
export default function Lightbox({ images, index, onClose, onPrev, onNext }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  if (index == null || index < 0 || index >= images.length) return null;
  const img = images[index];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        title="Cerrar (Esc)"
      >
        <X className="h-5 w-5" />
      </button>
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Anterior (←)"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Siguiente (→)"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}
      <img
        src={img.url}
        alt={img.filename}
        className="max-h-[88vh] max-w-[92vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
        {img.filename} · {index + 1} / {images.length}
      </div>
    </div>
  );
}