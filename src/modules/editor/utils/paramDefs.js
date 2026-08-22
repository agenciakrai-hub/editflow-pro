// Parameter definitions (wedding-raw-ai) — the 13 basic adjustment sliders.
export const PARAM_DEFS = [
  { key: "exposure", label: "Exposición", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "Contraste", min: -100, max: 100, step: 1 },
  { key: "highlights", label: "Luces altas", min: -100, max: 100, step: 1 },
  { key: "shadows", label: "Sombras", min: -100, max: 100, step: 1 },
  { key: "whites", label: "Blancos", min: -100, max: 100, step: 1 },
  { key: "blacks", label: "Negros", min: -100, max: 100, step: 1 },
  { key: "temperature", label: "Temperatura", min: -100, max: 100, step: 1 },
  { key: "tint", label: "Tinte", min: -100, max: 100, step: 1 },
  { key: "vibrance", label: "Vibrancia", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "Saturación", min: -100, max: 100, step: 1 },
  { key: "clarity", label: "Claridad", min: -100, max: 100, step: 1 },
  { key: "sharpness", label: "Nitidez", min: 0, max: 100, step: 1 },
];

export const DEFAULT_ADJUSTMENTS = Object.fromEntries(PARAM_DEFS.map((p) => [p.key, 0]));