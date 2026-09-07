import React from "react";
import { Lock, RotateCcw, SlidersHorizontal, Unlock } from "lucide-react";
import { getLayout } from "@/modules/album/layout/layoutCatalog";
import { freshTransform } from "@/modules/album/layout/layoutEngine";
import { mmToUnit, unitToMm } from "@/modules/album/lib/albumUnits";

// Fase 5.2 — Panel de propiedades contextual (derecha): info del spread + ajustes
// del hueco seleccionado (transformaciones VIRTUALES, no destructivas).
export default function PropertiesPanel({ album, spread, selectedSlot, onToggleLock, onSlotProp, onRemovePhoto, onRemoveSlot }) {
  const btn = "w-full rounded-lg border border-border px-2.5 py-1.5 text-left text-xs font-medium hover:bg-secondary disabled:opacity-40";
  const num = "w-full rounded-md border border-border bg-background px-2 py-1 text-xs tabular-nums";
  const unit = album.display_unit || "cm";

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-card p-3 lg:w-64">
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold">Propiedades</p>
      </div>

      {spread ? (
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-[11px] font-semibold">Spread</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {getLayout(spread.layout_id)?.name || "Libre (huecos sueltos)"} · {(spread.slots || []).filter((s) => s.photo_id).length} foto(s)
          </p>
          <button onClick={onToggleLock}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-secondary">
            {spread.locked ? <><Unlock className="h-3.5 w-3.5" /> Desbloquear</> : <><Lock className="h-3.5 w-3.5" /> Bloquear</>}
          </button>
        </div>
      ) : (
        <p className="text-[11px] leading-4 text-muted-foreground">Crea un spread para empezar.</p>
      )}

      {selectedSlot && spread && (
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-[11px] font-semibold">Hueco</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {selectedSlot.photo_id ? selectedSlot.photo?.filename || "Foto" : "Vacío"}
          </p>
          {selectedSlot.photo_id && !spread.locked && (
            <>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button className={btn + (selectedSlot.fit_mode === "fill" ? " bg-secondary" : "")} onClick={() => onSlotProp({ fit_mode: "fill" })}>Relleno</button>
                <button className={btn + (selectedSlot.fit_mode === "fit" ? " bg-secondary" : "")} onClick={() => onSlotProp({ fit_mode: "fit" })}>Contener</button>
              </div>
              <label className="mt-2 block text-[11px] text-muted-foreground">Zoom: {Math.round((selectedSlot.transform?.scale ?? 1) * 100)}%</label>
              <input type="range" min="30" max="400" value={Math.round((selectedSlot.transform?.scale ?? 1) * 100)}
                onChange={(e) => onSlotProp({ transform: { scale: Number(e.target.value) / 100 } })}
                className="w-full accent-foreground" />
            </>
          )}
          {!spread.locked && (
            <>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {[["X", "x_mm"], ["Y", "y_mm"], ["Ancho", "w_mm"], ["Alto", "h_mm"]].map(([label, key]) => (
                  <label key={key} className="block">
                    <span className="text-[10px] text-muted-foreground">{label} ({unit})</span>
                    <input type="number" step="0.1" className={num} value={mmToUnit(selectedSlot[key], unit)}
                      onChange={(e) => onSlotProp({ [key]: unitToMm(e.target.value, unit) })} />
                  </label>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {selectedSlot.photo_id && (
                  <button className={btn} onClick={() => onSlotProp({ transform: freshTransform() })}>
                    <span className="inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Centrar</span>
                  </button>
                )}
                {selectedSlot.photo_id && (
                  <button className={btn + " text-destructive hover:bg-destructive/10"} onClick={onRemovePhoto}>Quitar foto</button>
                )}
                <button className={btn + " text-destructive hover:bg-destructive/10"} onClick={onRemoveSlot}>Eliminar hueco</button>
              </div>
            </>
          )}
        </div>
      )}

      {spread && !selectedSlot && (
        <p className="text-[11px] leading-4 text-muted-foreground">Selecciona un hueco en el lienzo para ver sus propiedades.</p>
      )}
    </aside>
  );
}