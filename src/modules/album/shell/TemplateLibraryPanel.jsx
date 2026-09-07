import React, { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { LAYOUTS } from "@/modules/album/layout/layoutCatalog";
import { resolveSlots } from "@/modules/album/layout/layoutEngine";

// Fase Lienzos — Biblioteca COMPLETA de plantillas (panel izquierdo). Muestra TODAS
// las plantillas del catálogo (escalable a cientos: los layouts son datos) con
// miniatura de distribución real, número de fotos y filtros por cantidad. La lista
// FILTERS admite futuros criterios sin tocar el motor: basta añadir entradas.
const FILTERS = [
  { id: "all", label: "Todas", test: null },
  { id: "1", label: "1 foto", test: (c) => c === 1 },
  { id: "2", label: "2 fotos", test: (c) => c === 2 },
  { id: "3", label: "3 fotos", test: (c) => c === 3 },
  { id: "4", label: "4 fotos", test: (c) => c === 4 },
  { id: "5+", label: "5+ fotos", test: (c) => c >= 5 },
];

function TemplatePreview({ album, layout }) {
  const W = album.width_mm;
  const H = album.height_mm;
  const slots = resolveSlots(layout, album);
  return (
    <div className="relative w-full overflow-hidden rounded-md"
      style={{ aspectRatio: `${W} / ${H}`, backgroundColor: album.background_color || "#FFFFFF" }}>
      {slots.map((s) => (
        <div key={s.slot_id} className="absolute rounded-[2px] bg-foreground/60"
          style={{ left: `${(s.x_mm / W) * 100}%`, top: `${(s.y_mm / H) * 100}%`, width: `${(s.w_mm / W) * 100}%`, height: `${(s.h_mm / H) * 100}%` }} />
      ))}
    </div>
  );
}

export default function TemplateLibraryPanel({ album, spread, onApplyLayout }) {
  const [filter, setFilter] = useState("all");
  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
  const layouts = LAYOUTS.filter((l) => !active.test || active.test(l.count || l.slots.length));
  const disabled = !spread || spread.locked;
  const item = "group flex w-full flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <aside className="flex w-48 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card sm:w-56">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold">Plantillas</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{LAYOUTS.length} en total</span>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border px-2.5 pb-2 pt-2">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + (filter === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-2.5">
        <button disabled={disabled} onClick={() => onApplyLayout("custom")}
          className={item + (spread?.layout_id === "custom" ? " border-primary bg-secondary" : " border-border hover:border-foreground/30")}>
          <div className="flex w-full items-center justify-center rounded-md border border-dashed border-border bg-secondary/60" style={{ aspectRatio: `${album.width_mm} / ${album.height_mm}` }}>
            <span className="text-[10px] text-muted-foreground">Libre</span>
          </div>
          <span className="truncate text-[10px] font-medium">Huecos sueltos</span>
        </button>
        {layouts.map((l) => {
          const count = l.count || l.slots.length;
          return (
            <button key={l.id} disabled={disabled} onClick={() => onApplyLayout(l.id)} title={`${l.name} (${count} fotos)`}
              className={item + (spread?.layout_id === l.id ? " border-primary bg-secondary ring-1 ring-primary" : " border-border hover:border-foreground/30")}>
              <TemplatePreview album={album} layout={l} />
              <span className="truncate text-[10px] font-medium">{l.name}</span>
              <span className="text-[9px] text-muted-foreground">{count} foto{count === 1 ? "" : "s"}</span>
            </button>
          );
        })}
        {spread?.locked && (
          <p className="col-span-2 text-[10px] leading-4 text-amber-600">Lienzo bloqueado: desbloquéalo para aplicar plantillas.</p>
        )}
      </div>
    </aside>
  );
}