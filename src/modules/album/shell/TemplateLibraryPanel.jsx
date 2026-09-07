import React from "react";
import { LayoutTemplate } from "lucide-react";
import { compatibleLayouts, resolveSlots } from "@/modules/album/layout/layoutEngine";

// Fase 5.2 — Biblioteca visual de plantillas (panel izquierdo). Los layouts son
// DATOS del catálogo: aquí solo se PREVISUALIZAN y se aplican vía el motor, sin
// tocar geometría resuelta ni datos del spread.
function TemplatePreview({ album, layout }) {
  const W = album.width_mm;
  const H = album.height_mm;
  const slots = resolveSlots(layout, album);
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-secondary" style={{ aspectRatio: `${W} / ${H}` }}>
      {slots.map((s) => (
        <div key={s.slot_id} className="absolute rounded-[2px] bg-foreground/70"
          style={{ left: `${(s.x_mm / W) * 100}%`, top: `${(s.y_mm / H) * 100}%`, width: `${(s.w_mm / W) * 100}%`, height: `${(s.h_mm / H) * 100}%` }} />
      ))}
    </div>
  );
}

export default function TemplateLibraryPanel({ album, spread, onApplyLayout }) {
  const disabled = !spread || spread.locked;
  const photoCount = spread ? (spread.slots || []).filter((s) => s.photo_id).length : 0;
  const layouts = compatibleLayouts(album, photoCount);
  const item = "group flex w-full flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <aside className="flex w-44 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card sm:w-52">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold">Plantillas</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{spread ? `${photoCount} foto(s)` : ""}</span>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2.5">
        <button disabled={disabled} onClick={() => onApplyLayout("custom")}
          className={item + (spread?.layout_id === "custom" ? " border-primary bg-secondary" : " border-border hover:border-foreground/30")}>
          <div className="flex w-full items-center justify-center rounded-md border border-dashed border-border bg-secondary/60" style={{ aspectRatio: `${album.width_mm} / ${album.height_mm}` }}>
            <span className="text-[10px] text-muted-foreground">Libre</span>
          </div>
          <span className="truncate text-[10px] font-medium">Huecos sueltos</span>
        </button>
        {layouts.map((l) => (
          <button key={l.id} disabled={disabled} onClick={() => onApplyLayout(l.id)} title={`${l.name} (${l.min_photos}–${l.max_photos} fotos)`}
            className={item + (spread?.layout_id === l.id ? " border-primary bg-secondary ring-1 ring-primary" : " border-border hover:border-foreground/30")}>
            <TemplatePreview album={album} layout={l} />
            <span className="truncate text-[10px] font-medium">{l.name}</span>
          </button>
        ))}
        {spread?.locked && (
          <p className="col-span-2 text-[10px] leading-4 text-amber-600">Spread bloqueado: desbloquéalo para aplicar plantillas.</p>
        )}
      </div>
    </aside>
  );
}