import { Slider } from "@/components/ui/slider";
import { FlipHorizontal, FlipVertical, RotateCw, RotateCcw } from "lucide-react";
import { ASPECT_RATIOS } from "../utils/paramDefs.js";

export default function CropPanel({ adjustments, setAdjustments }) {
  const crop = adjustments.crop || {};

  const update = (key, val) => {
    setAdjustments((prev) => ({ ...prev, crop: { ...prev.crop, [key]: val } }));
  };
  const toggle = (key) => {
    setAdjustments((prev) => ({ ...prev, crop: { ...prev.crop, [key]: !prev.crop[key] } }));
  };
  const rotate = (deg) => {
    setAdjustments((prev) => ({ ...prev, crop: { ...prev.crop, rotate: ((prev.crop.rotate || 0) + deg) % 360 } }));
  };
  const reset = () => setAdjustments((prev) => ({ ...prev, crop: { angle: 0, aspect: "free", top: 0, bottom: 0, left: 0, right: 0, flipH: false, flipV: false, rotate: 0 } }));

  return (
    <div className="px-1 pb-2 space-y-3.5">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium w-20 shrink-0">Ángulo</span>
        <Slider value={[crop.angle ?? 0]} onValueChange={(v) => update("angle", v[0])} min={-45} max={45} step={0.1} className="flex-1" />
        <span className="text-xs font-mono w-12 text-right text-muted-foreground">{(crop.angle ?? 0).toFixed(1)}°</span>
      </div>
      <div>
        <span className="text-xs font-medium block mb-1.5">Relación de aspecto</span>
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_RATIOS.map((r) => (
            <button key={r.id} onClick={() => update("aspect", r.id)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${crop.aspect === r.id ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {[
        { key: "top", label: "Superior" },
        { key: "bottom", label: "Inferior" },
        { key: "left", label: "Izquierda" },
        { key: "right", label: "Derecha" },
      ].map((d) => (
        <div key={d.key} className="flex items-center gap-3">
          <span className="text-xs font-medium w-20 shrink-0">{d.label}</span>
          <Slider value={[crop[d.key] ?? 0]} onValueChange={(v) => update(d.key, v[0])} min={0} max={100} step={1} className="flex-1" />
          <span className="text-xs font-mono w-10 text-right text-muted-foreground">{crop[d.key] ?? 0}</span>
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={() => toggle("flipH")} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${crop.flipH ? "bg-accent text-white" : "bg-secondary"}`}><FlipHorizontal className="w-4 h-4" /> Voltear H</button>
        <button onClick={() => toggle("flipV")} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${crop.flipV ? "bg-accent text-white" : "bg-secondary"}`}><FlipVertical className="w-4 h-4" /> Voltear V</button>
      </div>
      <div className="flex gap-2">
        <button onClick={() => rotate(-90)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-secondary"><RotateCcw className="w-4 h-4" /> -90°</button>
        <button onClick={() => rotate(90)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-secondary"><RotateCw className="w-4 h-4" /> +90°</button>
        <button onClick={reset} className="px-3 py-2 rounded-lg text-xs font-medium bg-secondary ml-auto">Restablecer</button>
      </div>
    </div>
  );
}