// RAW AI Studio — motor de Balance de Blancos TÉCNICO, conservador y profesional para bodas.
// Sustituye al cálculo roto que escribía shifts -100..100 en crs:Temperature (interpretado
// por Lightroom como Kelvin absoluto → 2000 K absurdos). Ahora el WB es Kelvin absoluto:
//   finalKelvin = asShot.kelvin + deltaKelvin   (delta pequeño, acotado, modulado por confianza)
//
// Jerarquía de decisión (referencia para evaluar la dominante):
//   1. PIEL fiable (cobertura + confianza) → evalúa dominante preservando tono natural.
//   2. NEUTROS fiables (casi-blanco/casi-gris sin clipping) → lleva hacia neutro.
//   3. SEÑAL RGB global (p95 por canal, sin canales quemados) → respaldo.
//   4. Nada → no corregir (conserva As Shot).
//
// Reglas obligatorias:
//   - Confianza < 40% → NO escribe WB (Δ=0, Lightroom conserva As Shot).
//   - Dead-zone: dominante débil → Δ≈0.
//   - Techo ±1500 K, pero la corrección real = confianza × techo (progresiva).
//   - Excluye canales con clipping.
//   - Preserva calidez de tungsteno/atardecer (sin piel, no neutraliza agresivamente).
//   - Nunca 5500 K de baseline; nunca 2000 K por un delta.

const MAX_DELTA_KELVIN = 1500;
const MAX_DELTA_TINT = 40;
const WRITE_THRESHOLD = 40; // % confianza mínima para escribir WB
const DEAD_WARMTH = 0.04;
const DEAD_GREENNESS = 0.02;

// Objetivos cromáticos naturales (en ratios normalizados).
const SKIN_WARMTH_TARGET = 0.28;   // (r-b)/avg(r,b) de piel sana
const SKIN_GREENNESS_TARGET = -0.04;
const KELVIN_GAIN = 5500;          // ratio de warmth → Kelvin
const TINT_GAIN = 600;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const warmthOf = (r, g, b) => (r - b) / Math.max(1, (r + b) / 2);
const greennessOf = (r, g, b) => (g - (r + b) / 2) / Math.max(1, (r + g + b) / 3);

export function computeWhiteBalance(stats, skinStats, asShotWB, mode = "balanced") {
  // Sin As Shot fiable (RAW propietario) → no escribir WB. Lightroom conserva el original.
  if (!asShotWB || !asShotWB.kelvin) {
    return noWrite("none", "Sin As Shot WB fiable (RAW propietario)", asShotWB);
  }

  // 1. PIEL fiable — referencia primaria. Preserva tono natural: no neutraliza a blanco.
  if (skinStats && skinStats.coverage > 0.03 && skinStats.confidence > 0.4 && skinStats.meanRgb) {
    const ref = skinStats.meanRgb;
    const warmDev = warmthOf(ref.r, ref.g, ref.b) - SKIN_WARMTH_TARGET;
    const greenDev = greennessOf(ref.r, ref.g, ref.b) - SKIN_GREENNESS_TARGET;
    const conf = clamp(skinStats.confidence * 100 * (skinStats.coverage > 0.1 ? 1 : 0.8), 0, 90);
    return build(warmDev, greenDev, conf, "skin", asShotWB, skinStats);
  }

  // 2. NEUTROS fiables — casi-blanco/casi-gris sin clipping. Lleva hacia neutro.
  if (skinStats && skinStats.neutralMeanRgb && skinStats.neutralConfidence > 0.35) {
    const ref = skinStats.neutralMeanRgb;
    const warmDev = warmthOf(ref.r, ref.g, ref.b);
    const greenDev = greennessOf(ref.r, ref.g, ref.b);
    const conf = clamp(skinStats.neutralConfidence * 80, 0, 75);
    return build(warmDev, greenDev, conf, "neutral", asShotWB, skinStats);
  }

  // 3. SEÑAL RGB global — p95 por canal, excluyendo canales con clipping. Respaldo.
  const ch = stats?.channels;
  if (ch && ch.r && ch.g && ch.b) {
    const CLIP = 0.03;
    const usable = [];
    if (ch.r.clipPct < CLIP) usable.push("r");
    if (ch.g.clipPct < CLIP) usable.push("g");
    if (ch.b.clipPct < CLIP) usable.push("b");
    if (usable.length >= 2) {
      const p95 = { r: ch.r.p95, g: ch.g.p95, b: ch.b.p95 };
      const ref = usable.reduce((s, k) => s + p95[k], 0) / usable.length;
      const warmDev = warmthOf(p95.r, p95.g, p95.b);
      const greenDev = greennessOf(p95.r, p95.g, p95.b);
      const brightConf = clamp((ref - 120) / 80, 0, 1);
      const clipPenalty = usable.length === 3 ? 1 : 0.7;
      const conf = brightConf * clipPenalty * 55; // global capped lower (menos fiable que piel/neutros)
      return build(warmDev, greenDev, conf, "global", asShotWB, skinStats);
    }
  }

  // 4. Sin referencia fiable → no corregir.
  return noWrite("none", "Sin referencia fiable", asShotWB);
}

function build(warmDev, greenDev, confidence, source, asShotWB, skinStats) {
  let dK = 0, dT = 0;
  if (Math.abs(warmDev) > DEAD_WARMTH) dK = -warmDev * KELVIN_GAIN * (confidence / 100);
  if (Math.abs(greenDev) > DEAD_GREENNESS) dT = -greenDev * TINT_GAIN * (confidence / 100);

  // Techo ±1500 K / ±40 tint.
  dK = clamp(dK, -MAX_DELTA_KELVIN, MAX_DELTA_KELVIN);
  dT = clamp(dT, -MAX_DELTA_TINT, MAX_DELTA_TINT);

  // Preservación de atmósfera cálida (tungsteno/atardecer): sin piel que confirme la
  // dominante, no neutralizamos agresivamente una escena muy cálida.
  const hasSkin = skinStats && skinStats.coverage > 0.03 && skinStats.confidence > 0.4;
  if (!hasSkin && warmDev > 0.25) {
    dK = clamp(dK, -600, 0);
  }

  const write = confidence >= WRITE_THRESHOLD && (Math.abs(dK) > 20 || Math.abs(dT) > 2);
  const finalKelvin = write ? Math.round(asShotWB.kelvin + dK) : null;
  const finalTint = write ? Math.round((asShotWB.tint || 0) + dT) : null;

  return {
    write,
    source,
    reason: write
      ? `${source} · Δ${Math.round(dK)}K`
      : confidence < WRITE_THRESHOLD
        ? "Confianza insuficiente (conserva As Shot)"
        : "Sin corrección (dead-zone)",
    temperatureDelta: Math.round(dK),
    tintDelta: Math.round(dT),
    confidence: Math.round(confidence),
    asShotKelvin: asShotWB.kelvin,
    finalKelvin,
    finalTint,
  };
}

function noWrite(source, reason, asShotWB) {
  return {
    write: false,
    source,
    reason,
    temperatureDelta: 0,
    tintDelta: 0,
    confidence: 0,
    asShotKelvin: asShotWB?.kelvin ?? null,
    finalKelvin: null,
    finalTint: null,
  };
}