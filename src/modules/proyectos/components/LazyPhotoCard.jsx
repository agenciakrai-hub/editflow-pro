import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { STATUS_LABEL, STATUS_COLOR } from "./PhotoFingerprintGrid";

// Tarjeta de foto con renderizado diferido: solo renderiza el contenido completo
// (imagen, estrellas, botones) cuando la tarjeta está cerca del viewport.
// Esto evita que el navegador colapse (Error 5) con carpetas de 2000+ fotos,
// ya que solo se cargan y decodifican las imágenes visibles.
//
// Mientras la tarjeta no está visible, se renderiza un placeholder ligero (2 divs)
// que mantiene el espacio en la cuadrícula sin crear nodos DOM innecesarios.
// Una vez que entra en el viewport (con 500px de margen), se renderiza el contenido
// completo y permanece renderizado (sin re-observar) para evitar parpadeos.
export default function LazyPhotoCard({
  item, index, checked, onToggleSelect, onCycleClickState, onCycleStatus,
  onSetRating, onPhotoClick, onPhotoDoubleClick, onRangeReset,
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const review = !!item.aiReview || item.rating === 3;
  const green = item.rating === 5 || checked;

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-lg border bg-card ${review ? "border-yellow-400 ring-1 ring-yellow-400" : green ? "border-green-500 ring-1 ring-green-500" : "border-border"}`}
    >
      {visible ? (
        <>
          <div className="absolute left-1.5 top-1.5 z-10">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRangeReset(); onToggleSelect(item.id); }}
              className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? (review ? "border-yellow-400 bg-yellow-400 text-black" : "border-green-500 bg-green-500 text-white") : "border-white/70 bg-black/40 text-transparent hover:bg-black/60"}`}
            >
              {checked ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
            </button>
          </div>
          {item.previewUrl ? (
            <div
              className="aspect-square w-full cursor-pointer bg-black/5"
              title="Un clic cicla: verde (5★) → amarillo (3★) → sin color · Cmd/Ctrl+clic selecciona o deselecciona un rango (dos clics) · doble clic abre la vista previa"
              onClick={(e) => onPhotoClick(e, item, index)}
              onDoubleClick={() => onPhotoDoubleClick(index)}
            >
              <img src={item.previewUrl} alt={item.filename} className="h-full w-full object-contain" loading="lazy" decoding="async" />
            </div>
          ) : (
            <div className="aspect-square w-full bg-muted" />
          )}
          <div className="space-y-1 p-1.5">
            <p className="truncate text-[10px] font-mono text-muted-foreground">{item.filename}</p>
            <div className="flex items-center justify-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSetRating(item.id, item.rating === n ? 0 : n)}
                  title={item.rating === n ? `Quitar ${n} estrellas` : `${n} estrellas`}
                  className="p-0.5"
                >
                  <Star
                    className={
                      "h-3 w-3 " +
                      (item.rating >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")
                    }
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onCycleStatus(item.id)}
              className={`w-full rounded-md border px-1.5 py-1 text-[10px] font-medium ${STATUS_COLOR[item.status] || ""}`}
            >
              {STATUS_LABEL[item.status] || item.status}
            </button>
          </div>
        </>
      ) : (
        <div className="w-full">
          <div className="aspect-square w-full" />
          <div style={{ height: "60px" }} />
        </div>
      )}
    </div>
  );
}