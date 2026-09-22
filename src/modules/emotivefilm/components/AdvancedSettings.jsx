// Ajustes avanzados. Todos AUTO por defecto. Panel colapsable.
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const FIELDS = [
  { key: "emotion_intensity", label: "Intensidad emocional", type: "range", min: 0, max: 100, auto: 50 },
  { key: "couple_priority", label: "Protagonismo de pareja", type: "range", min: 0, max: 100, auto: 50 },
  { key: "rhythm", label: "Ritmo", type: "range", min: 0, max: 100, auto: 50 },
  { key: "max_photos", label: "Cantidad de fotos", type: "number", auto: 120, min: 20, max: 500 },
  { key: "target_duration", label: "Duración objetivo (s)", type: "number", auto: 180, min: 30, max: 600 },
  { key: "motion_intensity", label: "Intensidad de movimiento", type: "range", min: 0, max: 100, auto: 50 },
  { key: "transition_intensity", label: "Intensidad de transiciones", type: "range", min: 0, max: 100, auto: 50 },
  { key: "family_weight", label: "Peso de familia", type: "range", min: 0, max: 100, auto: 50 },
  { key: "friends_weight", label: "Peso de amigos", type: "range", min: 0, max: 100, auto: 50 },
  { key: "party_weight", label: "Peso de fiesta", type: "range", min: 0, max: 100, auto: 50 },
];

export default function AdvancedSettings({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const s = settings || {};

  const setField = (key, value) => {
    onChange({ ...s, [key]: value });
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-sm font-semibold"
      >
        Ajustes avanzados
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-foreground">
                    {s[f.key] == null || s[f.key] === "auto" ? "AUTO" : s[f.key]}
                  </span>
                  <button
                    onClick={() => setField(f.key, "auto")}
                    className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-secondary/70"
                  >
                    Auto
                  </button>
                </div>
              </div>
              {f.type === "range" ? (
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  value={s[f.key] == null || s[f.key] === "auto" ? f.auto : Number(s[f.key])}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                  className="mt-1 w-full accent-accent"
                />
              ) : (
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={s[f.key] == null || s[f.key] === "auto" ? f.auto : Number(s[f.key])}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              )}
            </div>
          ))}

          {/* === Proveedor I2V (HERO VIDEOS) === */}
          <div className="border-t border-border pt-4">
            <h4 className="text-xs font-semibold text-foreground">Proveedor I2V (HERO VIDEOS)</h4>

            <div className="mt-2">
              <label className="text-xs text-muted-foreground">Modo</label>
              <select
                value={s.i2v_provider || "auto"}
                onChange={(e) => setField("i2v_provider", e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="auto">AUTO — primer proveedor gratuito disponible</option>
                <option value="nvidia">NVIDIA Cosmos 3 Nano (FREE)</option>
                <option value="openrouter">OpenRouter (PREMIUM)</option>
                <option value="fal">fal.ai Kling 3.0 Pro (PREMIUM)</option>
              </select>
            </div>

            {/* NVIDIA — FREE, experimental */}
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              <span className="font-semibold shrink-0">NVIDIA FREE</span>
              <span>Endpoint gratuito. Diseñado para Physical AI (robótica/simulación). Experimental para bodas — puede producir movimiento menos natural en personas.</span>
            </div>
            <label className="mt-1.5 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.i2v_nvidia_enabled !== false}
                onChange={(e) => setField("i2v_nvidia_enabled", e.target.checked)}
              />
              <span>Habilitar NVIDIA (gratuito, activo por defecto)</span>
            </label>

            {/* OpenRouter — PREMIUM */}
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-500/10 p-2 text-[11px] text-blue-700 dark:text-blue-400">
              <span className="font-semibold shrink-0">OpenRouter PREMIUM</span>
              <span>Modelos de pago (Seedance, Veo, Wan...). Desde $0.03363/segundo. Requiere API key (OPENROUTER_API_KEY). Todos los modelos son de pago.</span>
            </div>
            <label className="mt-1.5 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.i2v_openrouter_enabled === true}
                onChange={(e) => setField("i2v_openrouter_enabled", e.target.checked)}
              />
              <span>Habilitar OpenRouter (pago — consumo bajo demanda)</span>
            </label>
            {s.i2v_openrouter_enabled && (
              <input
                type="text"
                value={s.i2v_openrouter_model || ""}
                onChange={(e) => setField("i2v_openrouter_model", e.target.value)}
                placeholder="bytedance/seedance-2.0-mini"
                className="mt-1.5 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
            )}

            {/* fal.ai — PREMIUM, desactivado */}
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 p-2 text-[11px] text-red-700 dark:text-red-400">
              <span className="font-semibold shrink-0">fal.ai PREMIUM</span>
              <span>Kling 3.0 Pro — máxima calidad I2V. Consume créditos de fal.ai. Desactivado por defecto.</span>
            </div>
            <label className="mt-1.5 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.i2v_fal_enabled === true}
                onChange={(e) => setField("i2v_fal_enabled", e.target.checked)}
              />
              <span>Habilitar fal.ai (pago — consume créditos)</span>
            </label>

            {/* Duración y máx shots */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Duración I2V (s)</label>
                <input
                  type="number"
                  min={3}
                  max={10}
                  value={s.i2v_duration || 5}
                  onChange={(e) => setField("i2v_duration", Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Máx HERO shots</label>
                <input
                  type="number"
                  min={5}
                  max={25}
                  value={s.i2v_max_shots || 20}
                  onChange={(e) => setField("i2v_max_shots", Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}