import React from "react";
import { Lock, RotateCcw, SlidersHorizontal, Unlock } from "lucide-react";
import { getLayout } from "@/modules/album/layout/layoutCatalog";
import { freshTransform } from "@/modules/album/layout/layoutEngine";
import { slotEffDpi } from "@/modules/album/editor/slotPhotoView";
import { mmToUnit, unitToMm } from "@/modules/album/lib/albumUnits";

const GAP_PRESETS = [0, 1, 2, 3, 4, 5];
const BG_PRESETS = [
  { value: "#FFFFFF", label: "Blanco" },
  { value: "#000000", label: "Negro" },
  { value: "#808080", label: "Gris" },
];

// Fase Lienzos — Panel de propiedades (derecha): configuración global del álbum
// (color de fondo + espacio entre fotos, visible al instante en el lienzo), info
// del lienzo activo y ajustes del hueco seleccionado (transformaciones VIRTUALES,
// no destructivas).
export default function PropertiesPanel({ album, spread, selectedSlot, onAlbumConfig, onToggleLock, onSlotProp, onRemovePhoto, onRemoveSlot }) {
  const btn = "w-full rounded-lg border border-border px-2.5 py-1.5 text-left text-xs font-medium hover:bg-secondary disabled:opacity-40";
  const num = "w-full rounded-md border border-border bg-background px-2 py-1 text-xs tabular-nums";
  const unit = album.display_unit || "cm";
  const gap = album.photo_gap_mm ?? 0;
  const bg = album.background_color || "#FFFFFF";
  const chip = "rounded-md border px-1.5 py-0.5 text-[10px] font-medium";

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-card p-3 lg:w-64">
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold">Propiedades</p>
      </div>

      {/* Configuración global del álbum */}
      <div className="rounded-lg border border-border p-2.5">
        <p className="text-[11px] font-semibold">Álbum</p>
        <p className="mt-1.5 text-[10px] text-muted-foreground">Color de fondo</p>
        <div className="mt-1 flex items-center gap-1.5">
          {BG_PRESETS.map((b) => (
            <button key={b.value} title={b.label} onClick={() => onAlbumConfig({ background_color: b.value })}
              className={"h-5 w-5 rounded-md border " + (bg.toLowerCase() === b.value.toLowerCase() ? "border-transparent ring-2 ring-primary" : "border-border hover:opacity-80")}
              style={{ backgroundColor: b.value }} />
          ))}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(bg) ? bg : "#FFFFFF"}
              onChange={(e) => onAlbumConfig({ background_color: e.target.value })}
              className="h-5 w-5 cursor-pointer rounded-md border border-border bg-transparent p-0" />
            Personalizado
          </label>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Espacio entre fotos (mm)</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {GAP_PRESETS.map((v) => (
            <button key={v} onClick={() => onAlbumConfig({ photo_gap_mm: v })}
              className={chip + (gap === v ? " border-primary bg-secondary font-semibold" : " border-border hover:bg-secondary")}>
              {v}
            </button>
          ))}
          <input type="number" min="0" max="40" step="0.5" value={gap}
            onChange={(e) => onAlbumConfig({ photo_gap_mm: Math.max(0, Number(e.target.value) || 0) })}
            className="w-14 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] tabular-nums" />
        </div>
        <p className="mt-1.5 text-[10px] leading-3 text-muted-foreground">
          Los lienzos con plantilla recalculan su geometría al cambiar el espacio.
        </p>
      </div>

      {spread ? (
        <div className="rounded-lg border border-border p-2.5">
          <p className="text-[11px] font-semibold">Lienzo</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {getLayout(spread.layout_id)?.name || "Libre (huecos sueltos)"} · {(spread.slots || []).filter((s) => s.photo_id).length} foto(s)
          </p>
          <button onClick={onToggleLock}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-secondary">
            {spread.locked ? <><Unlock className="h-3.5 w-3.5" /> Desbloquear</> : <><Lock className="h-3.5 w-3.5" /> Bloquear</>}
          </button>
        </div>
      ) : (
        <p className="text-[11px] leading-4 text-muted-foreground">Crea un lienzo para empezar.</p>
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
              <p className="mt-1 text-[10px] leading-3 text-muted-foreground">
                {selectedSlot.fit_mode === "fill"
                  ? "Cubre el hueco por defecto; aleja el zoom y arrastra la foto para reencuadrar sobre la foto original completa (el recorte es solo visual)."
                  : "Foto completa y centrada; arrastra o amplía el zoom para recortar."}
              </p>
              <label className="mt-2 block text-[11px] text-muted-foreground">Zoom: {Math.round((selectedSlot.transform?.scale ?? 1) * 100)}%</label>
              <input type="range" min="30" max="800" value={Math.round((selectedSlot.transform?.scale ?? 1) * 100)}
                onChange={(e) => onSlotProp({ transform: { scale: Number(e.target.value) / 100 } })}
                className="w-full accent-foreground" />
              {(() => {
                // Aviso de calidad — resolución efectiva (ppp) de la foto en este
                // hueco según su tamaño nativo y el zoom actual, frente al objetivo
                // de impresión del álbum.
                const eff = slotEffDpi(selectedSlot, selectedSlot.photo);
                if (eff == null) return null;
                const target = album.dpi || 300;
                const ok = eff >= target;
                const mid = eff >= target / 2;
                return (
                  <p className={"mt-1 text-[10px] leading-3 " + (ok ? "text-muted-foreground" : mid ? "text-amber-600" : "font-semibold text-destructive")}>
                    {ok
                      ? `Calidad óptima · ${Math.round(eff)} ppp (objetivo ${target})`
                      : mid
                        ? `⚠ Calidad reducida · ${Math.round(eff)} ppp (objetivo ${target})`
                        : `⚠ Pérdida de calidad · ${Math.round(eff)} ppp — reduce el zoom para imprimir a ${target} ppp`}
                  </p>
                );
              })()}
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