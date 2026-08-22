// Full Lightroom-style Develop toolset (wedding-raw-ai expanded).
// Flat adjustment keys (crs-friendly) grouped into UI sections.
// Nested objects: curve, hsl, grading, crop.

export const COLOR_KEYS = [
  { id: "red", label: "Rojo", hex: "#e53935" },
  { id: "orange", label: "Naranja", hex: "#fb8c00" },
  { id: "yellow", label: "Amarillo", hex: "#fdd835" },
  { id: "green", label: "Verde", hex: "#43a047" },
  { id: "aqua", label: "Cian", hex: "#00acc1" },
  { id: "blue", label: "Azul", hex: "#1e88e5" },
  { id: "purple", label: "Púrpura", hex: "#8e24aa" },
  { id: "magenta", label: "Magenta", hex: "#d81b60" },
];

export const SLIDER_SECTIONS = [
  {
    id: "light",
    label: "Luz",
    defs: [
      { key: "exposure", label: "Exposición", min: -100, max: 100, step: 1 },
      { key: "contrast", label: "Contraste", min: -100, max: 100, step: 1 },
      { key: "highlights", label: "Luces altas", min: -100, max: 100, step: 1 },
      { key: "shadows", label: "Sombras", min: -100, max: 100, step: 1 },
      { key: "whites", label: "Blancos", min: -100, max: 100, step: 1 },
      { key: "blacks", label: "Negros", min: -100, max: 100, step: 1 },
    ],
  },
  {
    id: "color",
    label: "Color",
    defs: [
      { key: "temperature", label: "Temperatura", min: -100, max: 100, step: 1 },
      { key: "tint", label: "Tinte", min: -100, max: 100, step: 1 },
      { key: "vibrance", label: "Vibrancia", min: -100, max: 100, step: 1 },
      { key: "saturation", label: "Saturación", min: -100, max: 100, step: 1 },
    ],
  },
  {
    id: "presence",
    label: "Presencia",
    defs: [
      { key: "texture", label: "Textura", min: -100, max: 100, step: 1 },
      { key: "clarity", label: "Claridad", min: -100, max: 100, step: 1 },
      { key: "dehaze", label: "Anti-neblina", min: -100, max: 100, step: 1 },
    ],
  },
  {
    id: "detail",
    label: "Detalle",
    defs: [
      { key: "sharpness", label: "Nitidez · Cantidad", min: 0, max: 100, step: 1 },
      { key: "sharpRadius", label: "Nitidez · Radio", min: 0, max: 3, step: 0.1 },
      { key: "sharpDetail", label: "Nitidez · Detalle", min: 0, max: 100, step: 1 },
      { key: "sharpMasking", label: "Nitidez · Enmascaramiento", min: 0, max: 100, step: 1 },
      { key: "noiseLuminance", label: "Reducción de ruido · Luminancia", min: 0, max: 100, step: 1 },
      { key: "noiseLumDetail", label: "Reducción de ruido · Detalle", min: 0, max: 100, step: 1 },
      { key: "noiseContrast", label: "Reducción de ruido · Contraste", min: 0, max: 100, step: 1 },
      { key: "colorNoise", label: "Ruido de color · Cantidad", min: 0, max: 100, step: 1 },
      { key: "colorDetail", label: "Ruido de color · Detalle", min: 0, max: 100, step: 1 },
      { key: "colorSmoothness", label: "Ruido de color · Suavidad", min: 0, max: 100, step: 1 },
    ],
  },
  {
    id: "lens",
    label: "Correcciones de lente",
    defs: [
      { key: "distortion", label: "Distorsión", min: -100, max: 100, step: 1 },
      { key: "chromaticAb", label: "Aberración cromática", min: -100, max: 100, step: 1 },
      { key: "defringePurple", label: "Desenmarque · Púrpura", min: 0, max: 100, step: 1 },
      { key: "defringeGreen", label: "Desenmarque · Verde", min: 0, max: 100, step: 1 },
      { key: "lensVignette", label: "Viñeta de lente · Cantidad", min: -100, max: 100, step: 1 },
      { key: "lensVignetteMid", label: "Viñeta de lente · Punto medio", min: 0, max: 100, step: 1 },
    ],
  },
  {
    id: "transform",
    label: "Transformar",
    defs: [
      { key: "transformVertical", label: "Vertical", min: -100, max: 100, step: 1 },
      { key: "transformHorizontal", label: "Horizontal", min: -100, max: 100, step: 1 },
      { key: "transformRotate", label: "Rotar", min: -45, max: 45, step: 0.1 },
      { key: "transformScale", label: "Escala", min: 50, max: 150, step: 1 },
      { key: "transformAspect", label: "Aspecto", min: -100, max: 100, step: 1 },
      { key: "transformOffsetX", label: "Desplazamiento X", min: -100, max: 100, step: 1 },
      { key: "transformOffsetY", label: "Desplazamiento Y", min: -100, max: 100, step: 1 },
    ],
  },
  {
    id: "effects",
    label: "Efectos",
    defs: [
      { key: "pcvAmount", label: "Viñeta · Cantidad", min: -100, max: 100, step: 1 },
      { key: "pcvMidpoint", label: "Viñeta · Punto medio", min: 0, max: 100, step: 1 },
      { key: "pcvRoundness", label: "Viñeta · Redondez", min: -100, max: 100, step: 1 },
      { key: "pcvFeather", label: "Viñeta · Pluma", min: 0, max: 100, step: 1 },
      { key: "pcvHighlights", label: "Viñeta · Luces altas", min: 0, max: 100, step: 1 },
      { key: "grainAmount", label: "Grano · Cantidad", min: 0, max: 100, step: 1 },
      { key: "grainSize", label: "Grano · Tamaño", min: 0, max: 100, step: 1 },
      { key: "grainRoughness", label: "Grano · Aspereza", min: 0, max: 100, step: 1 },
    ],
  },
  {
    id: "calibration",
    label: "Calibración de cámara",
    defs: [
      { key: "shadowTint", label: "Tinte de sombra", min: -100, max: 100, step: 1 },
      { key: "redHue", label: "Rojo primario · Matiz", min: -100, max: 100, step: 1 },
      { key: "redSaturation", label: "Rojo primario · Saturación", min: -100, max: 100, step: 1 },
      { key: "greenHue", label: "Verde primario · Matiz", min: -100, max: 100, step: 1 },
      { key: "greenSaturation", label: "Verde primario · Saturación", min: -100, max: 100, step: 1 },
      { key: "blueHue", label: "Azul primario · Matiz", min: -100, max: 100, step: 1 },
      { key: "blueSaturation", label: "Azul primario · Saturación", min: -100, max: 100, step: 1 },
    ],
  },
];

// Keep backward-compatible flat list (basic sliders) for any legacy import.
export const PARAM_DEFS = SLIDER_SECTIONS.flatMap((s) => s.defs);

const FLAT_DEFAULTS = Object.fromEntries(PARAM_DEFS.map((d) => [d.key, 0]));
FLAT_DEFAULTS.transformScale = 100;
FLAT_DEFAULTS.pcvMidpoint = 50;
FLAT_DEFAULTS.pcvFeather = 50;
FLAT_DEFAULTS.lensVignetteMid = 50;

export const DEFAULT_CURVE = {
  rgb: [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]],
  red: [[0, 0], [128, 128], [255, 255]],
  green: [[0, 0], [128, 128], [255, 255]],
  blue: [[0, 0], [128, 128], [255, 255]],
};

export const DEFAULT_HSL = Object.fromEntries(
  COLOR_KEYS.map((c) => [c.id, { h: 0, s: 0, l: 0 }]),
);

export const DEFAULT_GRADING = {
  shadowsHue: 0, shadowsSat: 0,
  midtonesHue: 0, midtonesSat: 0,
  highlightsHue: 0, highlightsSat: 0,
  blending: 50, balance: 0,
};

export const DEFAULT_CROP = {
  angle: 0, aspect: "free",
  top: 0, bottom: 0, left: 0, right: 0,
  flipH: false, flipV: false, rotate: 0,
};

export const ASPECT_RATIOS = [
  { id: "free", label: "Libre" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "3:2", label: "3:2" },
  { id: "16:9", label: "16:9" },
  { id: "2:3", label: "2:3" },
  { id: "3:4", label: "3:4" },
];

export const DEFAULT_ADJUSTMENTS = {
  ...FLAT_DEFAULTS,
  curve: DEFAULT_CURVE,
  hsl: DEFAULT_HSL,
  grading: DEFAULT_GRADING,
  crop: DEFAULT_CROP,
};

export function ensureDefaults(a) {
  if (!a) return DEFAULT_ADJUSTMENTS;
  return {
    ...FLAT_DEFAULTS,
    ...a,
    curve: a.curve || DEFAULT_CURVE,
    hsl: a.hsl || DEFAULT_HSL,
    grading: a.grading || DEFAULT_GRADING,
    crop: a.crop || DEFAULT_CROP,
  };
}