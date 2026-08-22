import { Sliders } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { PARAM_DEFS } from "../utils/paramDefs.js";

export default function ParameterPanel({ adjustments, onChange }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 mb-4">
        <Sliders className="w-4 h-4" />
        <h3 className="text-sm font-semibold">Ajustes básicos</h3>
      </div>
      <div className="space-y-3.5">
        {PARAM_DEFS.map((adj) => (
          <div key={adj.key} className="flex items-center gap-3">
            <span className="text-xs font-medium w-24 shrink-0">{adj.label}</span>
            <Slider value={[adjustments[adj.key] ?? 0]} onValueChange={(v) => onChange(adj.key, v[0])} min={adj.min} max={adj.max} step={adj.step} className="flex-1" />
            <span className="text-xs font-mono w-10 text-right text-muted-foreground">{(adjustments[adj.key] ?? 0) > 0 ? "+" : ""}{adjustments[adj.key] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}