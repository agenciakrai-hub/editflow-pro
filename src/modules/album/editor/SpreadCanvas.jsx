import React, { useEffect, useRef, useState } from "react";
import SlotFrame from "@/modules/album/editor/SlotFrame";
import { HAND_WHITE } from "@/modules/album/editor/cursors";

// Lienzo del spread (wireframe E, Fase 1 §9): mm → px según zoom, guías de sangrado,
// márgenes, zona segura y gutter. Soltar una foto sobre el lienzo crea un hueco libre.
export default function SpreadCanvas({ album, spread, photosById, zoomPct, guides, selectedSlotId, locked, slotMode, onSelectSlot, onSelectSlotContainer, onDropPhotoOnCanvas, onDropPhotosOnCanvas, handlers }) {
  const wrapRef = useRef(null);
  const [avail, setAvail] = useState(900);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => setAvail(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = album.width_mm;
  const H = album.height_mm;
  const bleed = album.bleed_mm ?? 3;
  const margin = album.margin_mm ?? 10;
  const gutter = album.gutter_mm ?? 6;
  const ppm = Math.max(0.05, ((Math.max(avail, 200) - 24) / (W + bleed * 2)) * (zoomPct / 100));
  const px = (mm) => mm * ppm;

  // Mano BLANCA — paneo del lienzo completo: arrastrar el fondo desplaza la vista y
  // NUNCA interviene en fotos ni contenedores (la foto requiere un clic y el
  // contenedor un doble clic para activarse). Un arrastre no cuenta como clic:
  // no deselecciona el hueco activo.
  const panRef = useRef(null);
  const suppressClickRef = useRef(false);
  const canvasPanStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = wrapRef.current;
    panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    const move = (ev) => {
      if (!panRef.current) return;
      if (Math.abs(ev.clientX - panRef.current.x) + Math.abs(ev.clientY - panRef.current.y) > 4) suppressClickRef.current = true;
      el.scrollLeft = panRef.current.sl - (ev.clientX - panRef.current.x);
      el.scrollTop = panRef.current.st - (ev.clientY - panRef.current.y);
    };
    const up = () => {
      panRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div ref={wrapRef} onMouseDown={canvasPanStart} style={{ cursor: HAND_WHITE }}
      className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-secondary/40 p-3">
      <div className="relative mx-auto"
        style={{ width: px(W), height: px(H), backgroundColor: album.background_color || "#FFFFFF", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // Colocación múltiple: si el arrastre trae VARIAS fotos, se elige y aplica
          // automáticamente una plantilla compatible con ese número y sus proporciones.
          const multi = e.dataTransfer.getData("text/album-photo-multi");
          if (multi && onDropPhotosOnCanvas) {
            try {
              const ids = JSON.parse(multi);
              if (Array.isArray(ids) && ids.length > 1) { onDropPhotosOnCanvas(ids); return; }
            } catch {}
          }
          const pid = e.dataTransfer.getData("text/album-photo");
          if (pid) onDropPhotoOnCanvas(pid);
        }}
        onClick={() => {
          if (suppressClickRef.current) { suppressClickRef.current = false; return; }
          onSelectSlot(null);
        }}>
        {guides.bleed && (
          <div className="pointer-events-none absolute border-2 border-dashed border-red-400"
            style={{ left: -px(bleed), top: -px(bleed), right: -px(bleed), bottom: -px(bleed) }} />
        )}
        {guides.margins && (
          <div className="pointer-events-none absolute border border-dashed border-blue-400"
            style={{ left: px(margin), top: px(margin), right: px(margin), bottom: px(margin) }} />
        )}
        {guides.safe && (
          <div className="pointer-events-none absolute border border-dashed border-emerald-400"
            style={{ left: px(margin + 3), top: px(margin + 3), right: px(margin + 3), bottom: px(margin + 3) }} />
        )}
        {guides.gutter && (
          <div className="pointer-events-none absolute border-l border-dashed border-neutral-400"
            style={{ left: px((W - gutter) / 2 + gutter / 2), top: 0, bottom: 0 }} />
        )}
        {(spread?.slots || []).map((sl) => (
          <SlotFrame key={sl.slot_id} slot={sl} locked={locked} ppm={ppm} projectId={album.id} targetDpi={album.dpi || 300}
            selected={selectedSlotId === sl.slot_id}
            photo={sl.photo_id ? photosById.get(sl.photo_id) : null}
            mode={slotMode}
            onSelect={() => onSelectSlot(sl.slot_id)}
            onEnterContainerMode={() => onSelectSlotContainer(sl.slot_id)}
            handlers={handlers} />
        ))}
      </div>
    </div>
  );
}