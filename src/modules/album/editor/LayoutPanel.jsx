import React from "react";
import { Lock, RotateCcw, Unlock } from "lucide-react";
import { compatibleLayouts, freshTransform } from "@/modules/album/layout/layoutEngine";
import { mmToUnit, unitToMm } from "@/modules/album/lib/albumUnits";

// Panel derecho (wireframe E): layouts compatibles (LAYOUT COMO DATOS, aplicados por el
// motor) + propiedades del hueco seleccionado + bloqueo del spread.
export default function LayoutPanel({ album, spread, selectedSlot, onApplyLayout, onToggleLock, onSlotProp, onRemovePhoto, onRemoveSlot }) {
  const btn = "w-full rounded-lg border border-border px-2.5 py-1.5 text-left text-xs font-medium hover:bg-secondary disabled:opacity-40";
  const num = "w-full rounded-md border border-border bg-background px-2 py-1 text-xs tabular-nums";
  const unit = album.display_unit || "cm";

  if (!spread) {
    return <aside className="w-64 shrink-0 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">Crea un spread para empezar.</aside>;
  }

  const photoCount = (spread.slots || []).filter((s) => s.photo_id).length;
  const layouts = compatibleLayouts(album, photoCount);
  const t = selectedSlot?.transform || {};

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3">
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-xs font-semibold">Layouts <span className="font-normal text-muted-foreground">· {photoCount} foto(s) en el spread</span></p>
        {spread.locked && (
          <p className="mt-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-800">Spread bloqueado: desbloquéalo para editar.</p>
        )}
        <div className="mt-2 space-y-1.5">
          <button className={btn + (spread.layout_id === "custom" ? " bg-secondary" : "")} disabled={spread.locked} onClick={() => onApplyLayout("custom")}>
            Libre (huecos sueltos)
          </button>
          {layouts.map((l) => (
            <button key={l.id} className={btn + (spread.layout_id === l.id ? " bg-secondary" : "")} disabled={spread.locked} onClick={() => onApplyLayout(l.id)}>
              {l.name} <span className="text-muted-foreground">({l.min_photos}–{l.max_photos})</span>
            </button>
          ))}
        </div>
      </div>

      {selectedSlot && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold">Hueco</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {selectedSlot.photo_id ? selectedSlot.photo?.filename || "Foto" : "Vacío"}
          </p>
          {selectedSlot.photo_id && !spread.locked && (
            <>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button className={btn + (selectedSlot.fit_mode === "fill" ? " bg-secondary" : "")} onClick={() => onSlotProp({ fit_mode: "fill" })}>Relleno</button>
                <button className={btn + (selectedSlot.fit_mode === "fit" ? " bg-secondary" : "")} onClick={() => onSlotProp({ fit_mode: "fit" })}>Contener</button>
              </div>
              <label className="mt-2 block text-[11px] text-muted-foreground">Zoom: {Math.round((t.scale ?? 1) * 100)}%</label>
              <input type="range" min="30" max="400" value={Math.round((t.scale ?? 1) * 100)}
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

      <button onClick={onToggleLock}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary">
        {spread.locked ? <><Unlock className="h-3.5 w-3.5" /> Desbloquear spread</> : <><Lock className="h-3.5 w-3.5" /> Bloquear spread</>}
      </button>
    </aside>
  );
}