import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { COLOR_KEYS } from "../utils/paramDefs.js";

const CHANNELS = [
  { id: "h", label: "Matiz", min: -180, max: 180 },
  { id: "s", label: "Saturación", min: -100, max: 100 },
  { id: "l", label: "Luminancia", min: -100, max: 100 },
];

export default function ColorMixerPanel({ adjustments, setAdjustments }) {
  const [channel, setChannel] = useState("h");
  const hsl = adjustments.hsl || {};

  const update = (color, val) => {
    setAdjustments((prev) => ({
      ...prev,
      hsl: { ...prev.hsl, [color]: { ...prev.hsl[color], [channel]: val } },
    }));
  };

  return (
    <div className="px-1 pb-2">
      <div className="flex gap-1.5 mb-3">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChannel(c.id)}
            className={`px-3 py-1 rounded-lg text-xs font-medium ${channel === c.id ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        {COLOR_KEYS.map((c) => {
          const def = CHANNELS.find((d) => d.id === channel);
          const v = hsl[c.id]?.[channel] ?? 0;
          return (
            <div key={c.id} className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full shrink-0 border border-border" style={{ background: c.hex }} />
              <span className="text-xs font-medium w-16 shrink-0">{c.label}</span>
              <Slider value={[v]} onValueChange={(val) => update(c.id, val[0])} min={def.min} max={def.max} step={1} className="flex-1" />
              <span className="text-xs font-mono w-10 text-right text-muted-foreground">{v > 0 ? "+" : ""}{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}