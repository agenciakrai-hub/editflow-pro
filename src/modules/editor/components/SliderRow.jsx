import { Slider } from "@/components/ui/slider";

export default function SliderRow({ def, value, onChange }) {
  const v = value ?? (def.min < 0 ? 0 : 0);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium w-32 shrink-0 leading-tight">{def.label}</span>
      <Slider
        value={[v]}
        onValueChange={(val) => onChange(def.key, val[0])}
        min={def.min}
        max={def.max}
        step={def.step}
        className="flex-1"
      />
      <span className="text-xs font-mono w-12 text-right text-muted-foreground">
        {v > 0 ? "+" : ""}{Number(v).toFixed(def.step < 1 ? 1 : 0)}
      </span>
    </div>
  );
}