// Preset profile (wedding-raw-ai) — creative layer applied on top of the basic
// auto adjustments: clarity, vibrance and saturation deltas per preset style.

export const CREATIVE_PRESETS = [
  { id: "natural", name: "Natural", category: "portrait", adjustments: { clarity: 5, vibrance: 10, saturation: 0 } },
  { id: "vivid", name: "Vívido", category: "landscape", adjustments: { clarity: 15, vibrance: 25, saturation: 10 } },
  { id: "muted", name: "Matizado", category: "editorial", adjustments: { clarity: -10, vibrance: -5, saturation: -15 } },
  { id: "warm", name: "Cálido", category: "wedding", adjustments: { clarity: 8, vibrance: 12, saturation: 5, temperature: 12 } },
  { id: "cool", name: "Frío", category: "wedding", adjustments: { clarity: 8, vibrance: 10, saturation: 0, temperature: -14 } },
  { id: "bwhigh", name: "B/N alto", category: "editorial", adjustments: { clarity: 20, vibrance: -100, saturation: -100 } },
];

export function applyCreativeLayer(baseAdjustments, preset) {
  if (!preset) return baseAdjustments;
  const merged = { ...baseAdjustments };
  for (const [k, v] of Object.entries(preset.adjustments || {})) {
    merged[k] = clamp((merged[k] || 0) + v);
  }
  return merged;
}

function clamp(v, min = -100, max = 100) {
  return Math.round(Math.max(min, Math.min(max, v)));
}