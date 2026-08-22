import { Slider } from "@/components/ui/slider";

const RANGES = [
  { id: "shadows", label: "Sombras", hueKey: "shadowsHue", satKey: "shadowsSat" },
  { id: "midtones", label: "Medios tonos", hueKey: "midtonesHue", satKey: "midtonesSat" },
  { id: "highlights", label: "Luces altas", hueKey: "highlightsHue", satKey: "highlightsSat" },
];

function hueToColor(hue, sat) {
  return `hsl(${hue}, ${Math.max(0, sat)}%, 50%)`;
}

export default function ColorGradingPanel({ adjustments, setAdjustments }) {
  const g = adjustments.grading || {};

  const update = (key, val) => {
    setAdjustments((prev) => ({ ...prev, grading: { ...prev.grading, [key]: val } }));
  };

  return (
    <div className="px-1 pb-2 space-y-4">
      {RANGES.map((r) => (
        <div key={r.id} className="rounded-xl bg-secondary/50 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-5 h-5 rounded-full border border-border"
              style={{ background: g[r.satKey] > 0 ? hueToColor(g[r.hueKey], g[r.satKey]) : "transparent" }}
            />
            <span className="text-sm font-semibold">{r.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium w-12 shrink-0">Matiz</span>
            <Slider value={[g[r.hueKey] ?? 0]} onValueChange={(v) => update(r.hueKey, v[0])} min={0} max={360} step={1} className="flex-1" />
            <span className="text-xs font-mono w-10 text-right text-muted-foreground">{g[r.hueKey] ?? 0}°</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium w-12 shrink-0">Sat.</span>
            <Slider value={[g[r.satKey] ?? 0]} onValueChange={(v) => update(r.satKey, v[0])} min={0} max={100} step={1} className="flex-1" />
            <span className="text-xs font-mono w-10 text-right text-muted-foreground">{g[r.satKey] ?? 0}</span>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium w-20 shrink-0">Mezcla</span>
        <Slider value={[g.blending ?? 50]} onValueChange={(v) => update("blending", v[0])} min={0} max={100} step={1} className="flex-1" />
        <span className="text-xs font-mono w-10 text-right text-muted-foreground">{g.blending ?? 50}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium w-20 shrink-0">Equilibrio</span>
        <Slider value={[g.balance ?? 0]} onValueChange={(v) => update("balance", v[0])} min={-100} max={100} step={1} className="flex-1" />
        <span className="text-xs font-mono w-10 text-right text-muted-foreground">{(g.balance ?? 0) > 0 ? "+" : ""}{g.balance ?? 0}</span>
      </div>
    </div>
  );
}