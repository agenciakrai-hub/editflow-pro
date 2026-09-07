import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

// Fase Carpetas — tira horizontal de miniaturas de la carpeta seleccionada: flechas,
// desvanecido en los bordes e indicador "X–Y de N". El tamaño lo fija el slider del
// navegador (thumbSize = altura en px); el ancho de cada celda sigue la orientación
// real de la foto (sin deformar).
//
// Colocación múltiple — CLIC selecciona (Ctrl/Cmd+clic alterna, Shift+clic rango);
// DOBLE CLIC abre la visualización ampliada. Arrastrar una foto seleccionada arrastra
// toda la selección: al soltarla sobre el lienzo, el editor crea automáticamente la
// plantilla adecuada al número de fotos (fit contain, sin recortes).
const RATIO = { portrait: 2 / 3, square: 1, landscape: 3 / 2 };

export default function ThumbStrip({ photos, previews, thumbSize, placedPhotoIds, selectedIds, onPhotoClick, onPhotoDoubleClick, emptyHint }) {
  const ref = useRef(null);
  const [range, setRange] = useState({ first: 0, last: 0, atStart: true, atEnd: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const n = photos.length;
    const atStart = el.scrollLeft <= 2;
    const atEnd = el.scrollWidth <= el.clientWidth || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    const avgW = n > 0 && el.scrollWidth > 0 ? el.scrollWidth / n : 1;
    const first = n ? Math.min(Math.max(0, Math.floor(el.scrollLeft / avgW)), n - 1) : 0;
    const last = n ? Math.min(n, first + Math.max(1, Math.ceil(el.clientWidth / avgW))) : 0;
    setRange({ first, last, atStart, atEnd });
  }, [photos.length]);

  useEffect(() => { measure(); }, [measure, thumbSize, photos]);

  const nudge = (dir) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.8), behavior: "smooth" });
  const arrowBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-foreground hover:bg-secondary disabled:opacity-30";
  const fade = "pointer-events-none absolute inset-y-0 z-10 w-6 transition-opacity";

  return (
    <div className="flex h-full items-stretch gap-1.5 px-2 pb-2 pt-1">
      <button className={arrowBtn + " self-center"} onClick={() => nudge(-1)} disabled={range.atStart} title="Anteriores">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="relative flex min-w-0 flex-1">
        {photos.length > 0 && (
          <div className={fade + " left-0 bg-gradient-to-r from-card to-transparent " + (range.atStart ? "opacity-0" : "opacity-100")} />
        )}
        {photos.length > 0 && (
          <div className={fade + " right-0 bg-gradient-to-l from-card to-transparent " + (range.atEnd ? "opacity-0" : "opacity-100")} />
        )}
        <div ref={ref} onScroll={measure} className="flex h-full items-center gap-2 overflow-x-auto pb-1">
          {photos.map((p, idx) => {
            const th = previews.get(p.id);
            const ratio = RATIO[p.orientation] || RATIO.landscape;
            const isSel = selectedIds?.has(p.id);
            return (
              <div key={p.id} title={p.filename + (th ? "" : " · sin preview local")}
                draggable
                onDragStart={(e) => {
                  const ids = isSel && selectedIds?.size > 1 ? Array.from(selectedIds) : [p.id];
                  e.dataTransfer.setData("text/album-photo", p.id);
                  if (ids.length > 1) e.dataTransfer.setData("text/album-photo-multi", JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={(e) => onPhotoClick(e, p, idx)}
                onDoubleClick={() => onPhotoDoubleClick(p)}
                className={"relative shrink-0 cursor-pointer overflow-hidden rounded-lg border bg-secondary transition-colors " + (isSel ? "border-primary ring-2 ring-primary" : "border-border hover:border-foreground/40")}
                style={{ height: thumbSize, width: Math.round(thumbSize * ratio) }}>
                {th ? (
                  <img src={th} draggable={false} alt={p.filename} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImageOff className="h-4 w-4" />
                    {p.preview_status === "unlinked" && <span className="text-[9px] font-medium">desvinculada</span>}
                  </div>
                )}
                {isSel && (
                  <span className="absolute left-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
                {placedPhotoIds?.has(p.id) && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" title="Colocada en un lienzo" />
                )}
              </div>
            );
          })}
          {photos.length === 0 && (
            <p className="self-center px-2 text-[11px] leading-5 text-muted-foreground">{emptyHint}</p>
          )}
        </div>
      </div>
      <button className={arrowBtn + " self-center"} onClick={() => nudge(1)} disabled={range.atEnd} title="Siguientes">
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="w-24 shrink-0 self-center text-right text-[10px] tabular-nums text-muted-foreground">
        {photos.length ? `${range.first + 1}–${range.last} de ${photos.length}` : "0 fotos"}
      </span>
    </div>
  );
}