import { Image } from "@/components/ui/image";
import { CREATIVE_PRESETS } from "../utils/presetProfile.js";

// Preset strip — creative layer loaded on top of the auto adjustments.
export default function PresetStrip({ presets, activePreset, onApplyPreset }) {
  const all = [...CREATIVE_PRESETS, ...presets.map((p) => ({ id: p.id, name: p.name, category: p.category, adjustments: p.adjustments }))];
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Presets</h3>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {all.map((p) => (
          <button key={p.id} onClick={() => onApplyPreset(p)} className={`shrink-0 w-20 rounded-xl border-2 overflow-hidden transition-colors ${activePreset?.id === p.id ? "border-accent" : "border-transparent"}`}>
            <div className="w-20 h-20 bg-gradient-to-br from-orange-200 to-amber-400 flex items-center justify-center text-[10px] font-bold text-white/80">{p.name}</div>
            <p className="text-[10px] font-medium p-1.5 text-left truncate bg-card">{p.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}