import React, { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Grip, ImageOff, Lock } from "lucide-react";
import usePhotoPreview from "@/modules/album/hooks/usePhotoPreview";
import { slotPhotoView, slotEffDpi, coverPanMargins } from "@/modules/album/editor/slotPhotoView";
import { HAND_BLACK, HAND_GREEN } from "@/modules/album/editor/cursors";

// Tiradores del contenedor en modo mano negra: los 4 lados y las 4 esquinas.
// Cada dir ancla el lado/corner OPUESTO; ⌘/Ctrl durante el arrastre conserva la
// proporción del contenedor.
const CONTAINER_HANDLES = [
  { dir: "nw", cls: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { dir: "n", cls: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
  { dir: "ne", cls: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { dir: "e", cls: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { dir: "se", cls: "-right-1.5 -bottom-1.5 cursor-nwse-resize" },
  { dir: "s", cls: "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize" },
  { dir: "sw", cls: "-left-1.5 -bottom-1.5 cursor-nesw-resize" },
  { dir: "w", cls: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
];

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
export default function SlotFrame({ slot, photo, projectId, ppm, targetDpi = 300, selected, locked, mode, onSelect, onEnterContainerMode, handlers }) {
  // Calidad dinámica del lienzo: resolución mínima que la foto necesita EN PANTALLA
  // (lado mayor del hueco × escala px/mm del zoom × densidad del dispositivo). El hook
  // carga la preview 1000 px inmediata y mejora desde el ORIGINAL si esta cifra la
  // supera; redondeada a pasos de 512 para no regenerar en cada píxel de zoom.
  const requiredEdge = useMemo(() => {
    const dpr = window.devicePixelRatio || 1;
    return Math.ceil((Math.max(slot.w_mm, slot.h_mm) * ppm * dpr) / 512) * 512;
  }, [slot.w_mm, slot.h_mm, ppm]);
  const previewUrl = usePhotoPreview(projectId, slot.photo_id, photo?.filename, requiredEdge, photo);
  const t = slot.transform || {};
  // ÚNICA fuente de verdad de la interpretación de fit_mode + transform (mismo módulo
  // que usa la miniatura del navegador): mismo FIT/CONTAIN (foto completa, centrada)
  // o COVER, misma transformación virtual. Sin interpretaciones locales.
  const view = slotPhotoView(slot);
  // TRES estados de interacción (mano blanca/verde/negra). Sin clic la foto está
  // INACTIVA (solo panea el lienzo): jamás se mueve por accidente. UN CLIC
  // selecciona y activa el modo FOTO (mano verde). DOBLE CLIC activa el modo
  // CONTENEDOR (mano negra: hueco libre con la foto congelada). Huecos VACÍOS:
  // contenedor directo (no hay foto que deslizar).
  const effMode = !slot.photo_id ? "container" : selected ? mode : "inactive";
  // Aviso de calidad en el propio hueco: la foto por debajo del objetivo de
  // impresión del álbum (ámbar) o de su mitad (rojo, pérdida evidente).
  const effDpi = slot.photo_id ? slotEffDpi(slot, photo) : null;
  const lowQuality = effDpi != null && effDpi < targetDpi;
  const wheelTs = useRef(0);
  const elRef = useRef(null);

  // P5 — un solo gesto activo; los listeners se limpian en mouseup Y al desmontar.
  const gestureCleanupRef = useRef(null);
  // El tercer argumento de onMove es el evento, para leer ⌘/Ctrl EN VIVO durante
  // el arrastre (proporción del contenedor conservada).
  const dragWindow = (e, onMove) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev) => onMove(ev.clientX - sx, ev.clientY - sy, ev);
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
    // Modo RELLENO: el reencuadre se limita al margen REAL de cobertura — la foto
    // nunca deja huecos al arrastrarla y todo el recorrido es encuadre válido.
    const m = slot.fit_mode === "fill" ? coverPanMargins(slot, photo) : null;
    dragWindow(e, (dx, dy) => {
      let nx = bx + dx / ppm;
      let ny = by + dy / ppm;
      if (m) { nx = Math.max(-m.mx, Math.min(m.mx, nx)); ny = Math.max(-m.my, Math.min(m.my, ny)); }
      handlers.onPan?.(slot.slot_id, nx, ny);
    });
  };

  // Modo CONTENEDOR (mano negra): arrastrar desde el CENTRO del hueco desplaza el
  // contenedor completo (la foto queda congelada dentro, sin deslizarse).
  const containerMoveStart = (e) => {
    if (locked || effMode !== "container") return;
    e.preventDefault(); e.stopPropagation(); onSelect();
    let began = false;
    const bx = slot.x_mm;
    const by = slot.y_mm;
    dragWindow(e, (dx, dy) => {
      // Historial solo si hay arrastre real (un clic sin mover no genera undo).
      if (!began && Math.abs(dx) + Math.abs(dy) > 2) { handlers.onGestureBegin?.(); began = true; }
      handlers.onMoveSlot?.(slot.slot_id, bx + dx / ppm, by + dy / ppm);
    });
  };

  // Redimensionado desde CUALQUIER lado o esquina ("n","s","e","w","ne","nw","se",
  // "sw"): el lado opuesto queda anclado. Con ⌘/Ctrl pulsado la PROPORCIÓN se
  // conserva (escala uniforme del hueco, anclada al lado opuesto o centrada).
  const boxStart = (e, dir) => {
    if (locked || effMode !== "container") return;
    e.preventDefault(); e.stopPropagation(); onSelect();
    handlers.onGestureBegin?.();
    const b = { x: slot.x_mm, y: slot.y_mm, w: slot.w_mm, h: slot.h_mm };
    const MIN = 15;
    dragWindow(e, (dx0, dy0, ev) => {
      const dx = dx0 / ppm;
      const dy = dy0 / ppm;
      const east = dir.includes("e"), west = dir.includes("w");
      const south = dir.includes("s"), north = dir.includes("n");
      if (ev && (ev.metaKey || ev.ctrlKey)) {
        const kx = east ? (b.w + dx) / b.w : west ? (b.w - dx) / b.w : null;
        const ky = south ? (b.h + dy) / b.h : north ? (b.h - dy) / b.h : null;
        const k = kx != null && ky != null ? Math.max(kx, ky) : (kx ?? ky);
        if (k == null) return;
        const w = Math.max(MIN, b.w * k);
        const h = Math.max(MIN, b.h * k);
        handlers.onBoxSlot?.(slot.slot_id, {
          w, h,
          x: west ? b.x + b.w - w : east ? b.x : b.x - (w - b.w) / 2,
          y: north ? b.y + b.h - h : south ? b.y : b.y - (h - b.h) / 2,
        });
        return;
      }
      let { x, y, w, h } = b;
      if (east) w = Math.max(MIN, b.w + dx);
      if (west) { w = Math.max(MIN, b.w - dx); x = b.x + (b.w - w); }
      if (south) h = Math.max(MIN, b.h + dy);
      if (north) { h = Math.max(MIN, b.h - dy); y = b.y + (b.h - h); }
      handlers.onBoxSlot?.(slot.slot_id, { x, y, w, h });
    });
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
    <div ref={elRef} className="absolute" style={{ left: slot.x_mm * ppm, top: slot.y_mm * ppm, width: slot.w_mm * ppm, height: slot.h_mm * ppm, zIndex: 10 + (slot.z_index || 0), cursor: effMode === "container" && !locked ? HAND_BLACK : "default" }}
      onMouseDown={containerMoveStart}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!locked && slot.photo_id) handlers.onToggleContainerMode?.(slot.slot_id); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        // Colocación MÚLTIPLE (selección arrastrada): la gestiona el LIENZO, que
        // distribuye todas las fotos en los huecos vacíos de la plantilla actual.
        // NO se hace stopPropagation: el evento debe burbujear hasta el contenedor
        // del lienzo. Solo una foto individual cae en ESTE hueco concreto.
        if (e.dataTransfer.getData("text/album-photo-multi")) return;
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
                objectFit: view.objectFit,
                transform: `translate(${(t.offset_x_mm || 0) * ppm}px, ${(t.offset_y_mm || 0) * ppm}px) scale(${view.scale})`,
                transformOrigin: "center",
                cursor: effMode === "photo" ? HAND_GREEN : "default",
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
      {lowQuality && (
        <div title={`La foto rinde ${Math.round(effDpi)} ppp a esta ampliación (objetivo ${targetDpi} ppp): pierde calidad en impresión. Reduce el zoom o usa un contenedor menor.`}
          className="pointer-events-none absolute bottom-1 right-1 z-20 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-white shadow"
          style={{ backgroundColor: effDpi < targetDpi / 2 ? "#dc2626" : "#d97706" }}>
          <AlertTriangle className="h-3 w-3" /> {Math.round(effDpi)} ppp
        </div>
      )}
      {selected && locked && (
        <div className="absolute right-1 top-1 z-20 text-neutral-500"><Lock className="h-3.5 w-3.5" /></div>
      )}
      {selected && !locked && slot.photo_id && (
        <span className={"absolute -top-5 left-0 z-20 rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white shadow " + (effMode === "photo" ? "bg-emerald-600" : "bg-neutral-900")}
          title={effMode === "photo"
            ? "Mano VERDE — modo FOTO (un clic): arrastra para reencuadrar la foto, rueda para zoom · doble clic pasa a modo contenedor"
            : "Mano NEGRA — modo CONTENEDOR (doble clic): arrastra desde el centro para mover el hueco · tiradores en lados y esquinas para redimensionar (⌘/Ctrl conserva la proporción) · la foto queda congelada · sale con un clic fuera o doble clic"}>
          {effMode === "photo" ? "Foto" : "Contenedor"}
        </span>
      )}
      {selected && !locked && slot.photo_id && (
        <div draggable title="Arrastra la foto a otro hueco" onDragStart={(e) => e.dataTransfer.setData("text/album-slot", slot.slot_id)}
          className="absolute -left-2.5 -top-2.5 z-20 flex h-5 w-5 cursor-grab items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Grip className="h-3 w-3" />
        </div>
      )}
      {selected && !locked && effMode === "container" && CONTAINER_HANDLES.map((hnd) => (
        <div key={hnd.dir} title="Arrastra para redimensionar el contenedor · ⌘/Ctrl conserva la proporción · arrastra desde el centro para moverlo"
          onMouseDown={(e) => boxStart(e, hnd.dir)}
          className={"absolute z-20 h-3 w-3 rounded-sm border border-background bg-primary shadow " + hnd.cls} />
      ))}
    </div>
  );
}