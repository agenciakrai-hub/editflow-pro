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
export function adaptPhotoWithProfile(stats, profile, precisionMode = "balanced", preferences = {}, enabledParams = null) {
  const recipe = (profile && profile.base_recipe) || {};
  const keys = enabledParams && enabledParams.length ? enabledParams : Object.keys(RANGES);
  const local = stats ? computeTechnicalBaseline(stats, precisionMode) : null;
  const final = {};
  for (const key of keys) {
    const base = typeof recipe[key] === "number" ? recipe[key] : 0;
    let val;
    if (EXPOSURE_TIED_KEYS.includes(key) && local) {
      // El motor local refina la corrección técnica por foto sobre la dirección base.
      val = base + (local.values[key] || 0);
    } else {
      // Claves creativas: uniformes para toda la sesión (look coherente).
      val = base;
    }
    const pref = Number(preferences?.[key]) || 0;
    final[key] = clamp(key, val + pref);
  }
  return final;
}