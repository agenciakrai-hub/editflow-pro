import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { SIZE_PRESETS, DEFAULT_ALBUM, deriveOrientation, ORIENTATION_LABEL, unitToMm, validateDimensions, EVENT_LABEL, STYLE_LABEL } from "@/modules/album/lib/albumUnits";

// Formulario de creación de álbum (Fase 1 wireframe B). Unidad seleccionable; la
// orientación SIEMPRE se deriva de las dimensiones (nunca se guarda aparte).
export default function AlbumCreateForm({ creating, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState("30x30");
  const [unit, setUnit] = useState("cm");
  const [width, setWidth] = useState("30");
  const [height, setHeight] = useState("30");
  const [advanced, setAdvanced] = useState(false);
  const [gutter, setGutter] = useState(String(DEFAULT_ALBUM.gutter_mm));
  const [margin, setMargin] = useState(String(DEFAULT_ALBUM.margin_mm));
  const [bleed, setBleed] = useState(String(DEFAULT_ALBUM.bleed_mm));
  const [eventType, setEventType] = useState(DEFAULT_ALBUM.event_type);
  const [style, setStyle] = useState(DEFAULT_ALBUM.style_hint);
  const [target, setTarget] = useState(String(DEFAULT_ALBUM.spread_count_target));
  const [maxPhotos, setMaxPhotos] = useState(String(DEFAULT_ALBUM.max_photos_per_spread));
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

  // P6 — al cambiar de unidad se CONVIERTEN los valores escritos (30 cm pasa a 300 mm),
  // nunca se reinterpretedan. La geometría interna siempre termina en mm canónicos.
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

  const orientation = useMemo(() => {
    const w = unitToMm(width, unit);
    const h = unitToMm(height, unit);
    return validateDimensions(w, h) ? ORIENTATION_LABEL[deriveOrientation(w, h)] : null;
  }, [width, height, unit]);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError("Ponle un nombre al álbum"); return; }
    const w = unitToMm(width, unit);
    const h = unitToMm(height, unit);
    if (!validateDimensions(w, h)) { setError("Dimensiones fuera de rango (100–500 mm por lado)"); return; }
    onCreate({
      name: name.trim(), event_type: eventType, width_mm: w, height_mm: h,
      size_preset: presetId, display_unit: unit,
      gutter_mm: Number(gutter) || 6, margin_mm: Number(margin) || 10, bleed_mm: Number(bleed) || 3,
      style_hint: style, spread_count_target: Number(target) || 20,
      max_photos_per_spread: Number(maxPhotos) || 6,
      dpi: DEFAULT_ALBUM.dpi, status: "draft", doc_version: "v1",
    });
  };

  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <form onSubmit={submit} className="space-y-4">
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
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Tamaño</label>
          <select className={field} value={presetId} onChange={(e) => pickPreset(e.target.value)}>
            {SIZE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Ancho</label>
          <input className={field} type="number" min="1" step="0.1" value={width} onChange={(e) => { setWidth(e.target.value); setPresetId("custom"); }} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Alto</label>
          <input className={field} type="number" min="1" step="0.1" value={height} onChange={(e) => { setHeight(e.target.value); setPresetId("custom"); }} />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Unidad:</span>
          <select className="rounded-lg border border-border bg-background px-2 py-1 text-sm" value={unit} onChange={(e) => changeUnit(e.target.value)}>
            <option value="cm">cm</option>
            <option value="mm">mm</option>
          </select>
          {orientation && <span className="ml-auto rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">{orientation}</span>}
        </div>
      </div>
      <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs font-medium text-accent hover:underline">
        {advanced ? "− Opciones avanzadas" : "+ Opciones avanzadas (gutter, márgenes, sangrado…)"}
      </button>
      {advanced && (
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-secondary/40 p-3">
          <div><label className="text-xs text-muted-foreground">Gutter (mm)</label><input className={field} type="number" min="0" value={gutter} onChange={(e) => setGutter(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Márgenes (mm)</label><input className={field} type="number" min="0" value={margin} onChange={(e) => setMargin(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Sangrado (mm)</label><input className={field} type="number" min="0" value={bleed} onChange={(e) => setBleed(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Spreads aprox.</label><input className={field} type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">Máx. fotos/spread</label><input className={field} type="number" min="1" value={maxPhotos} onChange={(e) => setMaxPhotos(e.target.value)} /></div>
          <div className="col-span-3">
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