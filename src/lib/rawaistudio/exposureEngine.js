// RAW AI Studio — motor TÉCNICO de exposición/luces/sombras/blancos/negros. Calcula una
// propuesta base determinista a partir de las estadísticas fotométricas reales de la
// preview (percentiles, clipping) — nunca de que un LLM "adivine" mirando la imagen.
// La IA (base44/shared/rawAiStudioEngine.ts) solo puede aportar un ajuste contextual
// pequeño y acotado sobre esta base, nunca sustituirla.
export const PRECISION_MODES = {
  conservative: { maxExposureEV: 0.35, maxToneUnits: 20, maxTemp: 15, maxTint: 8, targetMedian: [110, 150], label: "Conservador" },
  balanced: { maxExposureEV: 0.6, maxToneUnits: 35, maxTemp: 20, maxTint: 10, targetMedian: [105, 155], label: "Equilibrado" },
  aggressive: { maxExposureEV: 1.0, maxToneUnits: 55, maxTemp: 25, maxTint: 12, targetMedian: [100, 160], label: "Agresivo" }
};

// Claves técnicas que el motor local refina por foto (base del perfil IA + delta
// fotométrico local). Contrast/Temperature/Tint ahora también: el look creativo de
// sesión viene del perfil IA; el motor local solo corrige el sesgo técnico individual.
export const EXPOSURE_TIED_KEYS = [
  "Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012",
  "Temperature", "Tint"
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Contrast2012 (delta técnico, NO estilo): estira SUAVEMENTE un histograma poco
// contrastado (dispersión p5→p95 baja) y SIN clipping severo. Si la imagen ya tiene
// contraste suficiente o presenta clipping → 0. Común a computeTechnicalBaseline y
// computeFreeBaseline (sin duplicar lógica).
export function computeContrastDelta(stats, mode = "balanced") {
  const cfg = PRECISION_MODES[mode] || PRECISION_MODES.balanced;
  const spread = (stats.p95 != null && stats.p5 != null) ? (stats.p95 - stats.p5) : 128;
  if (spread >= 110) return 0;
  if (stats.clipHighlightPct >= 0.03 || stats.clipShadowPct >= 0.03) return 0;
  return Math.round(clamp((110 - spread) / 110 * cfg.maxToneUnits * 0.4, 0, cfg.maxToneUnits * 0.4));
}

// Balance de blancos per-foto (Temperature/Tint). Referencia: altas luces casi neutras
// (p95 por canal) ponderadas por su fiabilidad. No hay medias por canal disponibles sin
// tocar photometricAnalysis, así que cuando las altas luces no son fiables (poco
// brillantes o saturadas) la confianza cae y el delta tiende a 0 — nunca una dominante
// débil produce una corrección fuerte. Corrige HACIA EL NEUTRO: cast cálido (R>B) →
// Temperature negativo (enfriar); cast verde (G alto) → Tint negativo (magenta).
// El delta se suma sobre la base de sesión del perfil IA, conservando el look global.
export function computeWhiteBalanceDelta(stats, mode = "balanced") {
  const cfg = PRECISION_MODES[mode] || PRECISION_MODES.balanced;
  const ch = stats.channels;
  const zero = { Temperature: 0, Tint: 0 };
  if (!ch || !ch.r || !ch.g || !ch.b) return zero;

  const CLIP_LIMIT = 0.03;
  const usable = [];
  if (ch.r.clipPct < CLIP_LIMIT) usable.push("r");
  if (ch.g.clipPct < CLIP_LIMIT) usable.push("g");
  if (ch.b.clipPct < CLIP_LIMIT) usable.push("b");
  if (usable.length < 2) return zero;

  const p95 = { r: ch.r.p95, g: ch.g.p95, b: ch.b.p95 };
  const ref = usable.reduce((s, k) => s + p95[k], 0) / usable.length;

  // Fiabilidad: las altas luces deben ser realmente brillantes para asumirlas neutras.
  const brightConf = clamp((ref - 120) / 80, 0, 1); // 0 a ≤120, 1 a ≥200
  const clipPenalty = usable.length === 3 ? 1 : 0.75;
  const conf = brightConf * clipPenalty;
  if (conf < 0.25) return zero; // señal débil → no corregir

  const DEAD = 6; // dead-zone: asimetrías < 6 unidades no corrigen
  let tempDelta = 0, tintDelta = 0;

  if (usable.includes("r") && usable.includes("b")) {
    const asym = p95.r - p95.b; // >0 = cast cálido
    if (Math.abs(asym) >= DEAD) tempDelta = clamp(-asym * 0.5, -cfg.maxTemp, cfg.maxTemp) * conf;
  }
  if (usable.includes("g") && usable.includes("r") && usable.includes("b")) {
    const asym = p95.g - (p95.r + p95.b) / 2; // >0 = cast verde
    if (Math.abs(asym) >= DEAD) tintDelta = clamp(-asym * 0.4, -cfg.maxTint, cfg.maxTint) * conf;
  }

  return { Temperature: Math.round(tempDelta), Tint: Math.round(tintDelta) };
}

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

  // Blancos: corrección gradual y conservadora (no binaria). Dead-zone si p99 <= 248.
  // La severidad crece con cuánto se acerca p99 al blanco puro y se modula por el
  // clipping real — una foto con margen en altas luces recibe poca o ninguna corrección.
  let whites = 0;
  if (stats.p99 > 248) {
    const proximity = clamp((stats.p99 - 248) / 7, 0, 1);
    const clipBoost = clamp(stats.clipHighlightPct * 5, 0, 1);
    whites = -clamp(proximity * (0.5 + clipBoost * 0.5) * cfg.maxToneUnits * 0.6, 0, cfg.maxToneUnits * 0.6);
  }
  // Negros: gradual y conservador. Dead-zone si p1 >= 6.
  let blacks = 0;
  if (stats.p1 < 6) {
    const proximity = clamp((6 - stats.p1) / 6, 0, 1);
    const clipBoost = clamp(stats.clipShadowPct * 5, 0, 1);
    blacks = clamp(proximity * (0.5 + clipBoost * 0.5) * cfg.maxToneUnits * 0.6, 0, cfg.maxToneUnits * 0.6);
  }

  const contrast = computeContrastDelta(stats, mode);
  const wb = computeWhiteBalanceDelta(stats, mode);

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
      Contrast2012: contrast,
      Highlights2012: Math.round(highlights),
      Shadows2012: Math.round(shadows),
      Whites2012: Math.round(whites),
      Blacks2012: Math.round(blacks),
      Temperature: wb.Temperature,
      Tint: wb.Tint
    },
    confidence,
    mode
  };
}

// Modo GRATIS (/ajustes-ia): baseline técnico + Contrast2012 determinista (corrección
// tonal conservadora, NO estilo) + guard analítico de clipping. Reutiliza
// computeTechnicalBaseline sin alterarlo (el modo Qwen sigue usándolo igual que antes).
// Cero IA, cero red para análisis. Prioridad: precisión fotométrica > naturalidad >
// conservación de información > intensidad del ajuste.
export function computeFreeBaseline(stats, mode = "balanced") {
  const base = computeTechnicalBaseline(stats, mode);
  const cfg = PRECISION_MODES[mode] || PRECISION_MODES.balanced;
  // Contrast2012 ya viene del baseline (computeContrastDelta, sin duplicar lógica).
  const values = { ...base.values };

  // Guard analítico de clipping (post-baseline, determinista): no empeora el clipping
  // existente. Mantiene los límites del modo; solo anula correcciones que irían en
  // contra de la información ya quemada/aplastada.
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

  const bothClipped = stats.clipHighlightPct > 0.03 && stats.clipShadowPct > 0.03;
  const confidence = bothClipped ? clamp(base.confidence, 40, 60) : base.confidence;

  return { values, confidence, mode };
}