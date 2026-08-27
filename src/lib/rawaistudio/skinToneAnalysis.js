// RAW AI Studio — análisis de tono de piel determinista (100% local, sin modelos, sin red).
// Clasifica píxeles de la preview en espacio YCbCr (JPEG) para construir una máscara de
// piel y, en la MISMA pasada, localiza píxeles neutros fiables (casi-blanco/casi-gris sin
// clipping). No detecta rostros: la máscara de piel basta como REFERENCIA para evaluar la
// dominante de color y preservar un tono natural — nunca para neutralizar la piel a blanco.
//
// Salida: { coverage, meanRgb, confidence, bbox, neutralMeanRgb, neutralConfidence }
//   - coverage: fracción de píxeles clasificados como piel (0..1)
//   - meanRgb: media RGB de los píxeles de piel (referencia cromática)
//   - confidence: 0..1 (cobertura × factor de croma)
//   - neutralMeanRgb: media RGB de píxeles neutros fiables (para WB por neutros)
//   - neutralConfidence: 0..1 (nº de píxeles neutros × brillo)

const MAX_DIM = 480;

function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo decodificar la preview para análisis de piel"));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

// Umbrales YCbCr (JPEG) para tono de piel humano genérico. Rango amplio pero acotado:
// cubre pieles claras a medias; pieles muy oscuras quedan fuera (Y bajo) a propósito
// porque su croma es poco fiable en una preview JPEG comprimida.
const SKIN_Y_MIN = 40;
const SKIN_CB = [77, 127];
const SKIN_CR = [133, 173];

// Neutros: píxeles casi-grises, ni muy oscuros ni quemados, con canales cercanos.
const NEUTRAL_BRIGHT = [80, 240];
const NEUTRAL_MAX_DIFF = 14;

export async function analyzeSkinTone(base64Jpeg) {
  const img = await loadImage(base64Jpeg);
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const total = w * h;

  let skinCount = 0, sR = 0, sG = 0, sB = 0;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let neutralCount = 0, nR = 0, nG = 0, nB = 0, nBrightSum = 0;

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    // Piel
    if (y >= SKIN_Y_MIN && cb >= SKIN_CB[0] && cb <= SKIN_CB[1] && cr >= SKIN_CR[0] && cr <= SKIN_CR[1]) {
      skinCount++;
      sR += r; sG += g; sB += b;
      const px = p % w, py = Math.floor(p / w);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }

    // Neutros fiables (para WB por neutros)
    const bright = (r + g + b) / 3;
    if (bright >= NEUTRAL_BRIGHT[0] && bright <= NEUTRAL_BRIGHT[1] &&
        r < 245 && g < 245 && b < 245 &&
        Math.abs(r - g) < NEUTRAL_MAX_DIFF && Math.abs(g - b) < NEUTRAL_MAX_DIFF && Math.abs(r - b) < NEUTRAL_MAX_DIFF + 4) {
      neutralCount++;
      nR += r; nG += g; nB += b;
      nBrightSum += bright;
    }
  }

  const coverage = skinCount / total;
  const meanRgb = skinCount ? { r: sR / skinCount, g: sG / skinCount, b: sB / skinCount } : null;
  // Confianza de piel: cobertura suficiente + que la piel tenga croma real (no gris).
  let confidence = 0;
  if (meanRgb) {
    const sat = Math.abs(meanRgb.r - meanRgb.b) / 255;
    confidence = Math.min(1, coverage * 12) * Math.min(1, sat * 4);
  }
  const bbox = skinCount ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;

  const neutralCoverage = neutralCount / total;
  const neutralMeanRgb = neutralCount ? { r: nR / neutralCount, g: nG / neutralCount, b: nB / neutralCount } : null;
  const avgNeutralBright = neutralCount ? nBrightSum / neutralCount : 0;
  const neutralConfidence = neutralCount
    ? Math.min(1, neutralCoverage * 20) * Math.min(1, avgNeutralBright / 160)
    : 0;

  return { coverage, meanRgb, confidence, bbox, neutralMeanRgb, neutralConfidence };
}