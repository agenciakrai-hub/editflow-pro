import React, { useEffect, useRef } from "react";
import { Grip, ImageOff, Lock, Move } from "lucide-react";
import usePhotoPreview from "@/modules/album/hooks/usePhotoPreview";

// Un hueco del spread con transformaciones VIRTUALES (no destructivas): pan (crop),
// zoom, movimiento y redimensionado del marco. Todo se guarda en mm; el archivo
// original jamás se modifica. handlers llega vacío si el spread está bloqueado.
// Fase 3.1 Bloque 4: la preview de nivel 2 (1000 px) se carga BAJO DEMANDA con LRU
// compartido — nunca todas las fotos en memoria. Si la foto está missing/unlinked el
// hueco conserva íntegra su geometría (Bloque 3).
//
// Mejora encuadre — DOS MODOS de edición:
//   - "photo" (UN CLIC sobre la foto): se ajusta la FOTO (arrastrar = reencuadrar,
//     rueda = zoom). El contenedor permanece COMPLETAMENTE FIJO.
//   - "container" (DOBLE CLIC): se edita el CONTENEDOR (mover/redimensionar) con la
//     foto congelada; al cambiar su geometría, el motor recalcula sola la foto (auto
//     cover). Huecos SIN foto: el modo efectivo es siempre "container".
export default function SlotFrame({ slot, photo, projectId, ppm, selected, locked, mode, onSelect, onEnterContainerMode, handlers }) {
  const previewUrl = usePhotoPreview(projectId, slot.photo_id, photo?.filename);
  const t = slot.transform || {};
  const scale = t.scale ?? 1;
  // Corrección recorte — FIT/CONTAIN por defecto: la foto se ve COMPLETA (sin recorte
  // automático) manteniendo su proporción; "fill" (cover) queda solo como opción manual.
  const fit = slot.fit_mode || "fit";
  const effMode = slot.photo_id && mode !== "container" ? "photo" : "container";
  const wheelTs = useRef(0);
  const elRef = useRef(null);

  // P5 — un solo gesto activo; los listeners se limpian en mouseup Y al desmontar.
  const gestureCleanupRef = useRef(null);
  const dragWindow = (e, onMove) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      gestureCleanupRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    gestureCleanupRef.current = up;
  };
  useEffect(() => () => { if (gestureCleanupRef.current) gestureCleanupRef.current(); }, []);

  // Modo FOTO: reencuadre de la fotografía; el contenedor no se toca.
  const panStart = (e) => {
    if (!slot.photo_id || locked || effMode !== "photo") return;
    e.preventDefault(); e.stopPropagation(); onSelect();
    handlers.onGestureBegin?.();
    const bx = t.offset_x_mm || 0;
    const by = t.offset_y_mm || 0;
    dragWindow(e, (dx, dy) => handlers.onPan?.(slot.slot_id, bx + dx / ppm, by + dy / ppm));
  };

  // Modo CONTENEDOR: la foto queda bloqueada (no se desplaza ni se zooma).
  const moveStart = (e) => {
    if (locked || effMode !== "container") return;
    e.preventDefault(); e.stopPropagation(); onSelect();
    handlers.onGestureBegin?.();
    const bx = slot.x_mm;
    const by = slot.y_mm;
    dragWindow(e, (dx, dy) => handlers.onMoveSlot?.(slot.slot_id, bx + dx / ppm, by + dy / ppm));
  };

  const resizeStart = (e) => {
    if (locked || effMode !== "container") return;
    e.preventDefault(); e.stopPropagation(); onSelect();
    handlers.onGestureBegin?.();
    const bw = slot.w_mm;
    const bh = slot.h_mm;
    dragWindow(e, (dx, dy) => handlers.onResizeSlot?.(slot.slot_id, bw + dx / ppm, bh + dy / ppm));
  };

  // Wheel no pasivo (preventDefault) → listener manual. Solo en modo FOTO.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!slot.photo_id || locked || effMode !== "photo") return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - wheelTs.current > 1000) handlers.onGestureBegin?.();
      wheelTs.current = now;
      handlers.onZoomPhoto?.(slot.slot_id, e.deltaY < 0 ? 1.1 : 0.9);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [slot, locked, handlers, effMode]);

  return (
    <div ref={elRef} className="absolute" style={{ left: slot.x_mm * ppm, top: slot.y_mm * ppm, width: slot.w_mm * ppm, height: slot.h_mm * ppm, zIndex: 10 + (slot.z_index || 0) }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!locked && slot.photo_id) onEnterContainerMode?.(); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const pid = e.dataTransfer.getData("text/album-photo");
        const sid = e.dataTransfer.getData("text/album-slot");
        if (pid) handlers.onDropPhoto?.(slot.slot_id, pid);
        else if (sid && sid !== slot.slot_id) handlers.onSlotDrop?.(slot.slot_id, sid);
      }}>
      <div className="h-full w-full overflow-hidden bg-neutral-200"
        style={{ outline: selected ? "2px solid hsl(var(--primary))" : "1px dashed rgba(120,120,120,0.5)" }}>
        {slot.photo_id ? (
          previewUrl ? (
            <img src={previewUrl} alt={photo?.filename || ""} draggable={false} onMouseDown={panStart}
              className="h-full w-full select-none"
              style={{
                objectFit: fit === "fill" ? "cover" : "contain",
                transform: `translate(${(t.offset_x_mm || 0) * ppm}px, ${(t.offset_y_mm || 0) * ppm}px) scale(${scale})`,
                transformOrigin: "center",
                cursor: locked || effMode !== "photo" ? "default" : "grab",
              }} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-neutral-400">
              <ImageOff className="h-5 w-5" />
              <span className="max-w-full truncate px-1 text-[10px]">{photo?.filename || "Foto"}</span>
              <span className="text-[9px]">{photo?.preview_status === "unlinked" ? "foto desvinculada" : "preview no disponible"}</span>
            </div>
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-100 text-neutral-400">
            <ImageOff className="h-4 w-4" />
            <span className="text-[10px]">Suelta una foto aquí</span>
          </div>
        )}
      </div>
      {selected && locked && (
        <div className="absolute right-1 top-1 z-20 text-neutral-500"><Lock className="h-3.5 w-3.5" /></div>
      )}
      {selected && !locked && slot.photo_id && (
        <span className="absolute -top-5 left-0 z-20 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground shadow"
          title={effMode === "photo"
            ? "Modo FOTO: arrastra para reencuadrar, rueda para zoom · doble clic para editar el contenedor"
            : "Modo CONTENEDOR: mueve o redimensiona · la foto queda congelada y se reajusta automáticamente"}>
          {effMode === "photo" ? "Foto" : "Contenedor"}
        </span>
      )}
      {selected && !locked && slot.photo_id && (
        <div draggable title="Arrastra la foto a otro hueco" onDragStart={(e) => e.dataTransfer.setData("text/album-slot", slot.slot_id)}
          className="absolute -left-2.5 -top-2.5 z-20 flex h-5 w-5 cursor-grab items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Grip className="h-3 w-3" />
        </div>
      )}
      {selected && !locked && effMode === "container" && (
        <>
          <div title="Mover hueco" onMouseDown={moveStart}
            className="absolute -bottom-2.5 -left-2.5 z-20 flex h-5 w-5 cursor-move items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Move className="h-3 w-3" />
          </div>
          <div title="Redimensionar hueco" onMouseDown={resizeStart}
            className="absolute -bottom-1.5 -right-1.5 z-20 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-background bg-primary shadow" />
        </>
      )}
    </div>
  );
}