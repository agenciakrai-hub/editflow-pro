import { useEffect, useRef, useState } from "react";
import { getCachedPreview } from "../lib/previewCache";

// Miniatura de la tira inferior del visor con carga diferida: solo carga su
// preview desde IndexedDB cuando se acerca al viewport. Con 4000+ fotos, cargar
// todas las miniaturas a la vez agotaría la memoria; cada LazyThumb carga su
// preview solo cuando el usuario la va a ver.
export default function LazyThumb({ item, index, isActive, isMarked, isReview, thumbH, onClick }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(item.previewUrl || null);

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
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || previewUrl || !item.fingerprintHash) return;
    let cancelled = false;
    getCachedPreview(item.fingerprintHash)
      .then((p) => { if (!cancelled && p?.dataUrl) setPreviewUrl(p.dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, previewUrl, item.fingerprintHash]);

  return (
    <div
      ref={ref}
      data-thumb={index}
      onClick={onClick}
      className={
        "relative shrink-0 cursor-pointer overflow-hidden rounded-md border transition-opacity " +
        (isActive
          ? isReview
            ? "border-yellow-400 ring-2 ring-yellow-400"
            : isMarked
              ? "border-green-500 ring-2 ring-green-500"
              : "border-white ring-2 ring-white"
          : isReview
            ? "border-yellow-400"
            : isMarked
              ? "border-green-500"
              : "border-white/10")
      }
      title={item.filename}
    >
      {(isReview || isMarked) && (
        <span
          className={
            "absolute right-1 top-1 z-10 h-2.5 w-2.5 rounded-full ring-1 ring-black/50 " +
            (isReview ? "bg-yellow-400" : "bg-green-500")
          }
        />
      )}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={item.filename}
          style={{ height: thumbH, width: Math.round(thumbH * 1.4) }}
          className="object-cover"
        />
      ) : (
        <div style={{ height: thumbH, width: Math.round(thumbH * 1.4) }} className="bg-white/10" />
      )}
      <span className="absolute bottom-0.5 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1 text-[10px] text-white">
        {item.filename}
      </span>
    </div>
  );
}