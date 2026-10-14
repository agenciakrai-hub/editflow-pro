import { applyEnabledWhiteBalance } from "./developControls";
// Motor de adaptación HÍBRIDO (cliente). Aplica un PERFIL DE SESIÓN (generado por la IA
// desde K fotos representativas, ver hybridDevelopEngine.ts) y lo ADAPTA a cada foto
// usando fotometría local (analyzePhotometrics + computeTechnicalBaseline).
//
// División del trabajo:
//   - Claves creativas (Contraste, Temperatura, Tint, Vibración, Saturación, Claridad,
//     Nitidez): se toman TAL CUAL del perfil → look uniforme y coherente en toda la sesión.
//   - Claves técnicas (Exposición, Luces, Sombras, Blancos, Negros): el motor local suma
//     una corrección por foto (delta fotométrico) sobre la dirección base del perfil.
//
// Resultado: N fotos reveladas con UNA sola llamada de IA (la del perfil). Cero IA por
// foto. La adaptación local es 100% determinista y gratuita.

import { computeTechnicalBaseline, EXPOSURE_TIED_KEYS } from "./exposureEngine";
import { computeWhiteBalance } from "./whiteBalanceEngine";

const RANGES = {
  Exposure2012: { min: -5, max: 5 },
  Contrast2012: { min: -100, max: 100 },
  Highlights2012: { min: -100, max: 100 },
  Shadows2012: { min: -100, max: 100 },
  Whites2012: { min: -100, max: 100 },
  Blacks2012: { min: -100, max: 100 },
  Temperature: { min: -100, max: 100 },
  Tint: { min: -100, max: 100 },
  Vibrance: { min: -100, max: 100 },
  Saturation: { min: -100, max: 100 },
  Clarity2012: { min: -100, max: 100 },
  Sharpness: { min: 0, max: 100 },
};

const clamp = (k, v) => {
  const r = RANGES[k] || { min: -100, max: 100 };
  return Math.min(r.max, Math.max(r.min, v));
};

// Selecciona hasta `max` fotos representativas repartidas uniformemente sobre el total
// (muestreo determinista por índice). No necesita pHash ni EXIF: cubre el rango de la
// sesión sin agrupar. Si hay ≤ max fotos, las envía todas.
export function pickRepresentatives(photos, max = 8) {
  if (!photos?.length) return [];
  if (photos.length <= max) return [...photos];
  const out = [];
  const step = (photos.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(photos[Math.round(i * step)]);
  }
  return out;
}

// Adapta el perfil de sesión a una foto concreta usando su fotometría local.
//   stats     → salida de analyzePhotometrics (o null si no hay preview)
//   profile   → { base_recipe: { [key]: number }, ... }  (de generateSessionProfile)
//   enabledParams → lista de claves a rellenar (filtro de la UI); si se omite, todas.
export function buildHybridReference(allStats, mode = "balanced") {
  const samples = allStats.filter(Boolean).map(stats => computeTechnicalBaseline(stats, mode).values);
  if (!samples.length) throw new Error("No se pudo medir la exposición de las fotos representativas");
  return Object.fromEntries(EXPOSURE_TIED_KEYS.map(key => {
    const sorted = samples.map(sample => sample[key]).filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return [key, sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2];
  }));
}

export function adaptPhotoWithProfile(stats, profile, precisionMode = "balanced", preferences = {}, enabledParams = null, asShotWB = null, skinStats = null) {
  const recipe = (profile && profile.base_recipe) || {};
  const allKeys = enabledParams != null ? enabledParams : Object.keys(RANGES);
  // WB es Kelvin absoluto sobre As Shot (whiteBalanceEngine), no un shift crs:. Se maneja
  // fuera del dict de valores para que patchXmpAttributes no lo escriba como tono.
  const keys = allKeys.filter((k) => k !== "Temperature" && k !== "Tint");
  const local = stats ? computeTechnicalBaseline(stats, precisionMode) : null;
  const final = {};
  for (const key of keys) {
    const base = typeof recipe[key] === "number" ? recipe[key] : 0;
    let val;
    if (EXPOSURE_TIED_KEYS.includes(key) && local) {
      // El motor local refina la corrección técnica por foto sobre la dirección base.
      const reference = profile?.technical_reference?.[key];
      // El perfil ya corrige la sesión: añadir solo la diferencia respecto a sus representantes.
      val = Number.isFinite(reference) ? base + (local.values[key] || 0) - reference : base;
      // No oscurecer una toma claramente subexpuesta por arrastrar un perfil de otra luz.
      if (key === "Exposure2012" && local.values[key] > 0 && val < 0) val = local.values[key];
    } else {
      // Claves creativas: uniformes para toda la sesión (look coherente).
      val = base;
    }
    const pref = Number(preferences?.[key]) || 0;
    final[key] = clamp(key, val + pref);
  }
  // WB técnico per-foto sobre As Shot (no sobre el perfil IA de sesión).
  let wb = computeWhiteBalance(stats, skinStats, asShotWB, precisionMode);
  // Sin Kelvin/matiz calibrados, Lightroom calcula el WB desde el RAW al leer Auto.
  // Nunca inferir Kelvin absolutos desde los colores de un JPEG ya revelado.
  if (!wb.write && allKeys.includes("Temperature") && allKeys.includes("Tint") &&
      (!Number.isFinite(asShotWB?.kelvin) || !Number.isFinite(asShotWB?.tint) || asShotWB?.source === "dng-AsShotNeutral")) {
    wb = { ...wb, auto: true, write: true, source: "lightroom-auto", reason: "Balance automático calculado por Lightroom sobre el RAW" };
  }
  const wbEnabled = allKeys.includes("Temperature") || allKeys.includes("Tint");
  if (!wbEnabled) wb = { ...wb, write: false, reason: "WB desactivado por el usuario" };
  return { values: final, wb: applyEnabledWhiteBalance(wb, allKeys) };
}
// Un histograma bimodal no permite saber si el sujeto está en sombra o es una silueta.
// Esas tomas requieren análisis visual propio, no heredar el perfil medio del lote.
export function needsHybridVisualReview(stats) {
  return !!stats && Number.isFinite(stats.p25) && Number.isFinite(stats.p95) &&
    stats.p25 < 85 && stats.p95 > 225 && stats.p95 - stats.p25 > 145;
}
