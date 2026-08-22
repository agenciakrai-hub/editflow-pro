// RAW AI Studio — motor TÉCNICO de exposición/luces/sombras/blancos/negros. Calcula una
// propuesta base determinista a partir de las estadísticas fotométricas reales de la
// preview (percentiles, clipping) — nunca de que un LLM "adivine" mirando la imagen.
// La IA (base44/shared/rawAiStudioEngine.ts) solo puede aportar un ajuste contextual
// pequeño y acotado sobre esta base, nunca sustituirla.
export const PRECISION_MODES = {
  conservative: { maxExposureEV: 0.35, maxToneUnits: 20, targetMedian: [110, 150], label: "Conservador" },
  balanced: { maxExposureEV: 0.6, maxToneUnits: 35, targetMedian: [105, 155], label: "Equilibrado" },
  aggressive: { maxExposureEV: 1.0, maxToneUnits: 55, targetMedian: [100, 160], label: "Agresivo" }
};

export const EXPOSURE_TIED_KEYS = ["Exposure2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012"];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// stats: { p1, p5, p25, p50, p75, p95, p99, clipHighlightPct, clipShadowPct } — ver photometricAnalysis.js
export function computeTechnicalBaseline(stats, mode = "balanced") {
  const cfg = PRECISION_MODES[mode] || PRECISION_MODES.balanced;
  const [lowTarget, highTarget] = cfg.targetMedian;

  // Punto medio robusto: combina p25/p50/p75 en vez de solo la mediana, para no dejarse
  // engañar por histogramas bimodales típicos de boda (traje oscuro + vestido claro en el
  // mismo encuadre), donde la mediana sola puede caer en un valor poco representativo.
  const midtone = stats.p25 != null && stats.p75 != null
    ? stats.p25 * 0.25 + stats.p50 * 0.5 + stats.p75 * 0.25
    : stats.p50;

  // Exposición: desplaza el punto medio real hacia la zona objetivo. Nunca "centra el
  // histograma" a ciegas — solo corrige si el punto medio está realmente fuera de una zona
  // técnica razonable; una boda con mucho blanco/negro puede quedar igualmente sin ajuste.
  let exposure = 0;
  if (midtone < lowTarget) exposure = Math.log2(lowTarget / Math.max(1, midtone));
  else if (midtone > highTarget) exposure = Math.log2(highTarget / Math.max(1, midtone));
  exposure = clamp(exposure, -cfg.maxExposureEV, cfg.maxExposureEV);

  // Luces: severidad continua (no un umbral binario) en función del clipping real Y de
  // cuánto margen queda todavía antes del blanco puro — evita el salto brusco de "0 o
  // máximo" que daba antes, respondiendo de forma proporcional al problema real.
  let highlights = 0;
  if (stats.clipHighlightPct > 0.002) {
    const headroom = clamp((255 - stats.p95) / 30, 0, 1); // 1 = aún hay margen, 0 = ya al límite
    const severity = clamp(stats.clipHighlightPct * 5, 0, 1) * (1 - headroom * 0.4);
    highlights = -clamp(severity * cfg.maxToneUnits * 1.6, 0, cfg.maxToneUnits * 1.6);
  }

  // Sombras: misma lógica continua aplicada al extremo oscuro.
  let shadows = 0;
  if (stats.clipShadowPct > 0.002) {
    const headroom = clamp(stats.p5 / 30, 0, 1);
    const severity = clamp(stats.clipShadowPct * 5, 0, 1) * (1 - headroom * 0.4);
    shadows = clamp(severity * cfg.maxToneUnits, 0, cfg.maxToneUnits);
  }

  const whites = stats.p99 >= 253 ? -clamp(stats.clipHighlightPct * 200, 0, cfg.maxToneUnits * 0.6) : 0;
  const blacks = stats.p1 <= 2 ? clamp(stats.clipShadowPct * 200, 0, cfg.maxToneUnits * 0.6) : 0;

  // Confianza: baja si hay clipping simultáneo severo en ambos extremos (alto rango
  // dinámico difícil de resolver con un ajuste global) o si el ajuste ya toca el límite
  // del modo elegido — nunca se finge precisión cuando los datos son ambiguos.
  const bothClipped = stats.clipHighlightPct > 0.03 && stats.clipShadowPct > 0.03;
  const atLimit = Math.abs(exposure) >= cfg.maxExposureEV * 0.95;
  let confidence = 92;
  if (bothClipped) confidence -= 25;
  if (atLimit) confidence -= 15;
  confidence = clamp(confidence, 40, 96);

  return {
    values: {
      Exposure2012: Math.round(exposure * 100) / 100,
      Highlights2012: Math.round(highlights),
      Shadows2012: Math.round(shadows),
      Whites2012: Math.round(whites),
      Blacks2012: Math.round(blacks)
    },
    confidence,
    mode
  };
}