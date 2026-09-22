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
        </div>
      )}
    </div>
  );
}