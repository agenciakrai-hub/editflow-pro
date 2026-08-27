// RAW AI Studio — lista fija de parámetros de revelado que la IA puede tocar, cada uno
// con su rango técnico absoluto (solo para validar lo que el fotógrafo escribe — nunca se
// expone como "límite" de la corrección).
//
// La IA SIEMPRE calcula primero su corrección normal para cada foto. La "preferencia" del
// fotógrafo es un DESPLAZAMIENTO que se suma a ese resultado normal:
//   resultadoFinal = correcciónNormalIA + preferenciaFotógrafo
// Nunca un mínimo/máximo que limite a la IA.
export const PARAM_DEFS = [
  { key: "Exposure2012", label: "Exposición", min: -5, max: 5, step: 0.1, decimals: 2 },
  { key: "Contrast2012", label: "Contraste", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Highlights2012", label: "Luces", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Shadows2012", label: "Sombras", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Whites2012", label: "Blancos", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Blacks2012", label: "Negros", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Temperature", label: "Temperatura", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Tint", label: "Tinte", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Vibrance", label: "Vibración", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Saturation", label: "Saturación", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Clarity2012", label: "Claridad", min: -100, max: 100, step: 1, decimals: 0 },
  { key: "Sharpness", label: "Nitidez", min: 0, max: 60, step: 1, decimals: 0 }
];

// Todos activados por defecto, preferencia 0 = "aplicar la corrección normal de la IA sin desplazarla".
export function defaultParameterConfig() {
  const config = {};
  for (const p of PARAM_DEFS) config[p.key] = { enabled: true, preference: 0 };
  return config;
}

export function enabledKeys(config) {
  return PARAM_DEFS.filter((p) => config?.[p.key]?.enabled).map((p) => p.key);
}

// Preferencias (desplazamientos) de los parámetros activados, para enviar al motor IA.
export function preferencesFromConfig(config) {
  const preferences = {};
  for (const p of PARAM_DEFS) {
    if (config?.[p.key]?.enabled) preferences[p.key] = Number(config[p.key].preference) || 0;
  }
  return preferences;
}