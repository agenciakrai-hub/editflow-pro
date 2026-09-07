import React, { useEffect, useRef, useState } from "react";
import SlotFrame from "@/modules/album/editor/SlotFrame";

// Lienzo del spread (wireframe E, Fase 1 §9): mm → px según zoom, guías de sangrado,
// márgenes, zona segura y gutter. Soltar una foto sobre el lienzo crea un hueco libre.
export default function SpreadCanvas({ album, spread, photosById, zoomPct, guides, selectedSlotId, locked, onSelectSlot, onDropPhotoOnCanvas, handlers }) {
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

  return (
    <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-secondary/40 p-3">
      <div className="relative mx-auto"
        style={{ width: px(W), height: px(H), backgroundColor: album.background_color || "#FFFFFF", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const pid = e.dataTransfer.getData("text/album-photo");
          if (pid) onDropPhotoOnCanvas(pid);
        }}
        onClick={() => onSelectSlot(null)}>
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
          <SlotFrame key={sl.slot_id} slot={sl} locked={locked} ppm={ppm} projectId={album.id}
            selected={selectedSlotId === sl.slot_id}
            photo={sl.photo_id ? photosById.get(sl.photo_id) : null}
            onSelect={() => onSelectSlot(sl.slot_id)}
            handlers={handlers} />
        ))}
      </div>
    </div>
  );
}