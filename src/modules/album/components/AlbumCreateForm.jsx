import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { SIZE_PRESETS, DEFAULT_ALBUM, unitToMm, validateDimensions, EVENT_LABEL, STYLE_LABEL } from "@/modules/album/lib/albumUnits";

const GAP_PRESETS = [0, 1, 2, 3, 4, 5];
const BG_PRESETS = [
  { value: "#FFFFFF", label: "Blanco" },
  { value: "#000000", label: "Negro" },
  { value: "#808080", label: "Gris" },
];

// Formulario de creación (Fase Lienzos). El usuario define directamente el LIENZO —
// ancho × alto × unidad = área real de trabajo, sin cálculos de página, pliego ni
// orientación derivada — más el ESPACIO ENTRE FOTOS y el COLOR DE FONDO. Todo se
// almacena en mm canónicos; el espacio entre fotos no vive en las plantillas sino en
// la configuración del álbum (se aplica dinámicamente).
export default function AlbumCreateForm({ creating, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState(DEFAULT_ALBUM.event_type);
  const [unit, setUnit] = useState("cm");
  const [width, setWidth] = useState("60");
  const [height, setHeight] = useState("30");
  const [gap, setGap] = useState(3);
  const [bg, setBg] = useState("#FFFFFF");
  const [presetId, setPresetId] = useState("custom");
  const [advanced, setAdvanced] = useState(false);
  const [gutter, setGutter] = useState(String(DEFAULT_ALBUM.gutter_mm));
  const [margin, setMargin] = useState(String(DEFAULT_ALBUM.margin_mm));
  const [bleed, setBleed] = useState(String(DEFAULT_ALBUM.bleed_mm));
  const [target, setTarget] = useState(String(DEFAULT_ALBUM.spread_count_target));
  const [maxPhotos, setMaxPhotos] = useState(String(DEFAULT_ALBUM.max_photos_per_spread));
  const [style, setStyle] = useState(DEFAULT_ALBUM.style_hint);
  const [error, setError] = useState(null);

  const pickPreset = (id) => {
    setPresetId(id);
    const p = SIZE_PRESETS.find((s) => s.id === id);
    if (p) {
      setWidth((p.w / 10).toString());
      setHeight((p.h / 10).toString());
      setUnit("cm");
    }
  };

  // Al cambiar de unidad se CONVIERTEN los valores escritos (60 cm pasa a 600 mm).
  const convertValue = (v, from, to) => {
    const n = Number(v);
    if (v === "" || !isFinite(n)) return v;
    const mm = from === "cm" ? n * 10 : n;
    return String(Math.round((to === "cm" ? mm / 10 : mm) * 100) / 100);
  };
  const changeUnit = (to) => {
    setWidth((w) => convertValue(w, unit, to));
    setHeight((h) => convertValue(h, unit, to));
    setUnit(to);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError("Ponle un nombre al álbum"); return; }
    const w = unitToMm(width, unit);
    const h = unitToMm(height, unit);
    if (!validateDimensions(w, h)) { setError("Dimensiones fuera de rango (100–1000 mm por lado)"); return; }
    onCreate({
      name: name.trim(),
      event_type: eventType,
      width_mm: w,
      height_mm: h,
      size_preset: presetId,
      display_unit: unit,
      photo_gap_mm: Math.max(0, Number(gap) || 0),
      background_color: bg,
      gutter_mm: Number(gutter) || 6,
      margin_mm: Number(margin) || 10,
      bleed_mm: Number(bleed) || 3,
      style_hint: style,
      spread_count_target: Number(target) || 20,
      max_photos_per_spread: Number(maxPhotos) || 6,
      dpi: DEFAULT_ALBUM.dpi,
      status: "draft",
      doc_version: "v1",
    });
  };

  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Nombre del álbum</label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Boda Curro y Celia" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Tipo de reportaje</label>
          <select className={field} value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* LIENZO — tamaño directo: lo introducido es el área real de trabajo */}
      <div className="space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
        <p className="text-xs font-semibold">Lienzo</p>
        <div>
          <label className="text-xs text-muted-foreground">Medidas rápidas (opcional)</label>
          <select className={field} value={presetId} onChange={(e) => pickPreset(e.target.value)}>
            {SIZE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Ancho del lienzo</label>
            <input className={field} type="number" min="1" step="0.1" value={width} onChange={(e) => { setWidth(e.target.value); setPresetId("custom"); }} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Alto del lienzo</label>
            <input className={field} type="number" min="1" step="0.1" value={height} onChange={(e) => { setHeight(e.target.value); setPresetId("custom"); }} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Unidad</label>
            <select className={field} value={unit} onChange={(e) => changeUnit(e.target.value)}>
              <option value="cm">cm</option>
              <option value="mm">mm</option>
            </select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          El tamaño introducido es el área real de trabajo de cada lienzo del álbum.
        </p>
      </div>

      {/* ESPACIO ENTRE FOTOS + COLOR DE FONDO */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
          <p className="text-xs font-semibold">Espacio entre fotos</p>
          <div className="flex flex-wrap items-center gap-1">
            {GAP_PRESETS.map((v) => (
              <button key={v} type="button" onClick={() => setGap(v)}
                className={"rounded-md border px-2 py-1 text-xs font-medium " + (Number(gap) === v ? "border-primary bg-background font-semibold" : "border-border bg-background hover:border-foreground/30")}>
                {v}
              </button>
            ))}
            <input type="number" min="0" max="40" step="0.5" value={gap}
              onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs tabular-nums" />
            <span className="text-[11px] text-muted-foreground">mm</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Se aplica dinámicamente al usar plantillas (no está fijado en ellas).
          </p>
        </div>
        <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
          <p className="text-xs font-semibold">Color de fondo</p>
          <div className="flex items-center gap-2">
            {BG_PRESETS.map((b) => (
              <button key={b.value} type="button" title={b.label} onClick={() => setBg(b.value)}
                className={"h-6 w-6 rounded-md border " + (bg.toLowerCase() === b.value.toLowerCase() ? "border-transparent ring-2 ring-primary" : "border-border hover:opacity-80")}
                style={{ backgroundColor: b.value }} />
            ))}
            <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(bg) ? bg : "#FFFFFF"}
                onChange={(e) => setBg(e.target.value)}
                className="h-6 w-6 cursor-pointer rounded-md border border-border bg-transparent p-0" />
              Personalizado
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">Visible al instante en cada lienzo del editor.</p>
        </div>
      </div>

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs font-medium text-accent hover:underline">
        {advanced ? "− Opciones avanzadas" : "+ Opciones avanzadas (márgenes, sangrado…)"}
      </button>
      {advanced && (
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-secondary/40 p-3">
          <div><label className="text-xs text-muted-foreground">Márgenes (mm)</label><input className={field} type="number" min="0" value={margin} onChange={(e) => setMargin(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Sangrado (mm)</label><input className={field} type="number" min="0" value={bleed} onChange={(e) => setBleed(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Lienzos aprox.</label><input className={field} type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Máx. fotos/lienzo</label><input className={field} type="number" min="1" value={maxPhotos} onChange={(e) => setMaxPhotos(e.target.value)} /></div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Estilo de diseño</label>
            <select className={field} value={style} onChange={(e) => setStyle(e.target.value)}>
              {Object.entries(STYLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">Cancelar</button>
        <button type="submit" disabled={creating} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
          {creating && <Loader2 className="h-4 w-4 animate-spin" />} Crear álbum
        </button>
      </div>
    </form>
  );
}