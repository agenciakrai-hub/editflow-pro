// Miniatura lazy para la revisión de selección. Carga la preview bajo demanda
// desde IndexedDB cuando entra en el viewport.
import { useEffect, useRef, useState } from "react";
import { getCachedPreview } from "@/modules/proyectos/lib/previewCache";
import { Pin, Ban, X, Eye } from "lucide-react";

export default function FilmThumb({ item, onTogglePin, onToggleExclude, onRemove, onPreview }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: "200px" }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !item.fingerprint_hash) return;
    let alive = true;
    getCachedPreview(item.fingerprint_hash).then((p) => {
      if (alive && p?.dataUrl) setSrc(p.dataUrl);
    }).catch(() => {});
    return () => { alive = false; };
  }, [visible, item.fingerprint_hash]);

  const isExcluded = item.exclude;
  const isPinned = item.pin;

  return (
    <div
      ref={ref}
      className={
        "group relative aspect-square overflow-hidden rounded-lg border-2 bg-secondary transition-colors " +
        (isExcluded ? "border-destructive/60 opacity-50" : isPinned ? "border-accent" : "border-border")
      }
    >
      {src ? (
        <img src={src} alt={item.filename} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">…</div>
      )}

      {/* Badge de escena */}
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white capitalize">
        {item.scene}
      </span>

      {/* Badge de pareja */}
      {item.has_couple && (
        <span className="absolute right-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
          💑
        </span>
      )}

      {/* Controles al hover */}
      <div className="absolute inset-0 flex items-end justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onTogglePin?.(item.fingerprint_hash)}
          className={"rounded p-1.5 " + (isPinned ? "bg-accent text-accent-foreground" : "bg-white/80 text-black hover:bg-white")}
          title={isPinned ? "Quitar fijación" : "Fijar foto"}
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onToggleExclude?.(item.fingerprint_hash)}
          className={"rounded p-1.5 " + (isExcluded ? "bg-destructive text-white" : "bg-white/80 text-black hover:bg-white")}
          title={isExcluded ? "Recuperar" : "Excluir foto"}
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPreview?.(item)}
          className="rounded bg-white/80 p-1.5 text-black hover:bg-white"
          title="Ampliar"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onRemove?.(item.fingerprint_hash)}
          className="rounded bg-white/80 p-1.5 text-black hover:bg-white"
          title="Quitar del vídeo"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}