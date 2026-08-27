// RAW AI Studio — conversión de cromaticidad / neutral de cámara a Kelvin (WB As Shot).
// Usado para leer el WB real que la cámara eligió desde los tags DNG AsShotNeutral /
// AsShotWhiteXY. Nunca usa 5500 K como baseline: el baseline SIEMPRE es el As Shot real.
//
// Aproximación: AsShotNeutral vive en el espacio nativo de la cámara; sin la ColorMatrix
// del DNG no podemos convertirlo a xy exacto. Aproximamos tratando el neutral como RGB
// lineal en un espacio cercano a sRGB → xy → Kelvin (Mcamy). No es exacto al Kelvin, pero
// produce un baseline sane (2500-10000 K) sobre el que el motor aplica deltas pequeños y
// conservadores — nunca los 2000 K absurdos que producía el sistema anterior.

// Mcamy: xy → Kelvin (aproximación estándar, decente en 2500-10000 K).
export function xyToKelvin(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0.1858) return NaN;
  const n = (x - 0.3320) / (0.1858 - y);
  const k = 437 * n ** 3 + 3601 * n ** 2 + 6861 * n + 5517;
  return k;
}

// RGB (lineal, normalizado G=1) → xy vía matriz sRGB D65 (aproximación para camera-neutral).
function rgbToXy(r, g, b) {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const sum = X + Y + Z;
  if (sum <= 0) return { x: 0.3127, y: 0.3290 };
  return { x: X / sum, y: Y / sum };
}

function clampKelvin(k) {
  if (!Number.isFinite(k)) return NaN;
  return Math.round(Math.min(10000, Math.max(2500, k)));
}

// AsShotNeutral: [Rn, Gn, Bn] (normalizamos G=1) → Kelvin.
export function neutralToKelvin(r, g, b) {
  const { x, y } = rgbToXy(r, g, b);
  return clampKelvin(xyToKelvin(x, y));
}

// AsShotWhiteXY: [x, y] → Kelvin.
export function xyToKelvinClamped(x, y) {
  return clampKelvin(xyToKelvin(x, y));
}