// Auto Ajustes Básicos Pro — motor determinista 100% local para el modo GRATIS de
// Ajustes IA. NO usa InvokeLLM, Qwen, NVIDIA ni UploadFile: ningún proveedor, ninguna red.
// Analiza únicamente la preview embebida (histograma RGB por canal + luminancia, clipping
// de altas luces y sombras, distribución tonal y contraste global) y devuelve SIEMPRE los
// 6 parámetros básicos de revelado de Lightroom:
//   Exposure2012, Contrast2012, Highlights2012, Shadows2012, Whites2012, Blacks2012
//
// Filosofía: corrección TÉCNICA, no estilo. Nunca toca temperatura, tint, vibración,
// saturación, claridad, curvas, HSL, calibración ni máscaras — eso es decisión creativa
// del fotógrafo (o, en el futuro, de Qwen). Aquí solo se equilibra el tono de forma
// reproducible y gratuita, ideal para bodas donde la consistencia entre tomas importa
// más que el "gusto" variable de un modelo.

import { PRECISION_MODES } from "./exposureEngine";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round2 = (v) => Math.round(v * 100) / 100;

function midtoneOf(stats) {
  return stats.p25 != null && stats.p75 != null
    ? stats.p25 * 0.25 + stats.p50 * 0.5 + stats.p75 * 0.25
    : stats.p50;
}

function spreadOf(stats) {
  return stats.p95 != null && stats.p5 != null ? stats.p95 - stats.p5 : 128;
}

// Clipping de altas luces consciente del canal: el peor canal decide (un canal rojo
// quemado en piel cuenta como quemado aunque la luminancia combinada no llegue a 250).
function maxChannelClip(stats) {
  if (!stats.channels) return stats.clipHighlightPct;
  return Math.max(stats.channels.r.clipPct, stats.channels.g.clipPct, stats.channels.b.clipPct);
}

// ¿Esta foto necesita corrección? True si el punto medio está fuera de la zona técnica
// objetivo, hay clipping (luminancia o por canal) o el contraste global es bajo.
export function photoNeedsCorrection(stats, mode = "balanced") {
  const cfg = PRECISION_MODES[mode] || PRECISION_MODES.balanced;
  const [low, high] = cfg.targetMedian;
  const midtone = midtoneOf(stats);
  const spread = spreadOf(stats);
  const chanClip = maxChannelClip(stats);
  return (
    midtone < low || midtone > high ||
    stats.clipHighlightPct > 0.002 || stats.clipShadowPct > 0.002 ||
    chanClip > 0.002 ||
    spread < 110
  );
}

export function computeAutoBasicsPro(stats, mode = "balanced") {
  const cfg = PRECISION_MODES[mode] || PRECISION_MODES.balanced;
  const [lowTarget, highTarget] = cfg.targetMedian;
  const midtone = midtoneOf(stats);
  const spread = spreadOf(stats);
  const chanClip = maxChannelClip(stats);
  const hlClip = Math.max(stats.clipHighlightPct, chanClip);

  // --- Exposición: desplaza el punto medio real hacia la zona objetivo ---
  let exposure = 0;
  if (midtone < lowTarget) exposure = Math.log2(lowTarget / Math.max(1, midtone));
  else if (midtone > highTarget) exposure = Math.log2(highTarget / Math.max(1, midtone));
  exposure = clamp(exposure, -cfg.maxExposureEV, cfg.maxExposureEV);

  // --- Luces: severidad continua sobre el clipping real (consciente del canal) ---
  let highlights = 0;
  if (hlClip > 0.002) {
    const headroom = clamp((255 - stats.p95) / 30, 0, 1);
    const severity = clamp(hlClip * 5, 0, 1) * (1 - headroom * 0.4);
    highlights = -clamp(severity * cfg.maxToneUnits * 1.6, 0, cfg.maxToneUnits * 1.6);
  }

  // --- Sombras: misma lógica continua aplicada al extremo oscuro ---
  let shadows = 0;
  if (stats.clipShadowPct > 0.002) {
    const headroom = clamp(stats.p5 / 30, 0, 1);
    const severity = clamp(stats.clipShadowPct * 5, 0, 1) * (1 - headroom * 0.4);
    shadows = clamp(severity * cfg.maxToneUnits, 0, cfg.maxToneUnits);
  }

  // --- Blancos / Negros:回收 de los extremos del histograma ---
  const whites = (stats.p99 >= 253 || chanClip > 0.003)
    ? -clamp(Math.max(stats.clipHighlightPct, chanClip) * 200, 0, cfg.maxToneUnits * 0.6)
    : 0;
  const blacks = stats.p1 <= 2
    ? clamp(stats.clipShadowPct * 200, 0, cfg.maxToneUnits * 0.6)
    : 0;

  // --- Contraste: solo corrección tonal conservadora (estiramiento suave) ---
  let contrast = 0;
  if (spread < 110 && stats.clipHighlightPct < 0.03 && stats.clipShadowPct < 0.03) {
    contrast = Math.round(clamp((110 - spread) / 110 * cfg.maxToneUnits * 0.4, 0, cfg.maxToneUnits * 0.4));
  }

  const values = {
    Exposure2012: round2(exposure),
    Contrast2012: contrast,
    Highlights2012: Math.round(highlights),
    Shadows2012: Math.round(shadows),
    Whites2012: Math.round(whites),
    Blacks2012: Math.round(blacks),
  };

  // Guard analítico de clipping: nunca empeora el clipping existente.
  if (stats.clipHighlightPct > 0.03) {
    if (values.Exposure2012 > 0) values.Exposure2012 = 0;
    if (values.Highlights2012 > 0) values.Highlights2012 = 0;
    if (values.Whites2012 > 0) values.Whites2012 = 0;
  }
  if (stats.clipShadowPct > 0.03) {
    if (values.Exposure2012 < 0) values.Exposure2012 = 0;
    if (values.Shadows2012 < 0) values.Shadows2012 = 0;
    if (values.Blacks2012 < 0) values.Blacks2012 = 0;
  }

  // Garantía determinista: si la foto necesita corrección pero todos los valores
  // quedaron en 0 (caso límite de redondeo/umbrales), aplica un nudge mínimo según el
  // problema dominante. Nunca inventa estilo: solo el parámetro que la métrica indica.
  const needed = photoNeedsCorrection(stats, mode);
  const allZero = Object.values(values).every((v) => !v);
  if (needed && allZero) {
    if (midtone < lowTarget) values.Exposure2012 = round2(Math.min(0.15, cfg.maxExposureEV));
    else if (midtone > highTarget) values.Exposure2012 = round2(-Math.min(0.15, cfg.maxExposureEV));
    else if (spread < 110) values.Contrast2012 = Math.max(8, Math.round(cfg.maxToneUnits * 0.2));
    else if (hlClip > 0.002) values.Highlights2012 = -Math.max(8, Math.round(cfg.maxToneUnits * 0.2));
    else if (stats.clipShadowPct > 0.002) values.Shadows2012 = Math.max(8, Math.round(cfg.maxToneUnits * 0.2));
  }

  const bothClipped = stats.clipHighlightPct > 0.03 && stats.clipShadowPct > 0.03;
  const atLimit = Math.abs(values.Exposure2012) >= cfg.maxExposureEV * 0.95;
  let confidence = 92;
  if (bothClipped) confidence -= 25;
  if (atLimit) confidence -= 15;
  confidence = clamp(confidence, 40, 96);

  return {
    values,
    needsCorrection: needed,
    allZero: Object.values(values).every((v) => !v),
    confidence,
    mode,
    metrics: {
      midtone: Math.round(midtone),
      spread,
      clipHighlightPct: stats.clipHighlightPct,
      clipShadowPct: stats.clipShadowPct,
      maxChannelClip: chanClip,
    },
  };
}