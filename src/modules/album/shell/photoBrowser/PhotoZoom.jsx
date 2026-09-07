import React, { useEffect, useState } from "react";
import Lightbox from "@/components/Lightbox";

// Fase Carpetas — visualización ampliada de una foto: REUTILIZA el Lightbox global
// (Esc, flechas de navegación, contador "n / total") y añade una barra flotante con
// la carpeta de la foto y "Añadir al lienzo". Carga la preview de nivel 2 (1000 px)
// bajo demanda con el LRU existente; si no existe, el thumb. Nunca modifica la foto,
// su crop ni las transformaciones de los lienzos.
export default function PhotoZoom({ photos, index, thumbs, getPhotoPreview, folders, onMoveFolder, onAddToCanvas, onClose, onIndex }) {
  const [hiRes, setHiRes] = useState({});
  const photo = photos[index];

  useEffect(() => {
    const p = photos[index];
    if (!p || hiRes[p.id]) return undefined;
    let alive = true;
    getPhotoPreview(p.id)
      .then((u) => { if (alive && u) setHiRes((m) => ({ ...m, [p.id]: u })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [index, photos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!photo) return null;
  const images = photos.map((p) => ({ url: hiRes[p.id] || thumbs.get(p.id) || "", filename: p.filename }));

  return (
    <>
      <Lightbox images={images} index={index} onClose={onClose}
        onPrev={() => onIndex(Math.max(0, index - 1))}
        onNext={() => onIndex(Math.min(photos.length - 1, index + 1))} />
      <div className="fixed left-1/2 top-14 z-[110] flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur">
        <span className="max-w-48 truncate text-[11px] font-medium text-white">{photo.filename}</span>
        <select value={photo.folder || ""}
          onChange={(e) => { onMoveFolder([photo.id], e.target.value || null); onClose(); }}
          className="rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[11px] text-white">
          <option value="">Sin carpeta</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button onClick={() => { onAddToCanvas(photo.id); }}
          className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-black hover:opacity-90">
          Añadir al lienzo
        </button>
      </div>
    </>
  );
}