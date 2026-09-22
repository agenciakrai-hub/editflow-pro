// I2V Cost Guard — controla qué proveedores Image-to-Video pueden ejecutarse.
// Distingue FREE / PREMIUM / DISABLED. Impide llamadas de pago no autorizadas.
//
// Proveedores:
//   nvidia     — NVIDIA Cosmos 3 Nano (FREE, experimental — Physical AI)
//   openrouter — OpenRouter Video API (PREMIUM — todos los modelos de pago)
//   fal        — fal.ai Kling 3.0 Pro (PREMIUM — desactivado por defecto)

export const I2V_PROVIDERS = {
  nvidia: {
    id: "nvidia",
    name: "NVIDIA Cosmos 3 Nano",
    tier: "FREE",
    experimental: true,
    description:
      "Endpoint gratuito. Diseñado para Physical AI (robótica/simulación). " +
      "Experimental para bodas — puede producir movimiento menos natural en personas.",
    secretName: "NVIDIA_API_KEY",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter Video",
    tier: "PREMIUM",
    description:
      "Modelos de pago (Seedance, Veo, Wan...). Desde $0.03363/segundo. " +
      "Requiere API key propia (OPENROUTER_API_KEY). Todos los modelos son de pago.",
    secretName: "OPENROUTER_API_KEY",
    defaultModel: "bytedance/seedance-2.0-mini",
  },
  fal: {
    id: "fal",
    name: "fal.ai (Kling 3.0 Pro)",
    tier: "PREMIUM",
    description:
      "Máxima calidad I2V. Consume créditos de fal.ai. Desactivado por defecto.",
    secretName: "FAL_API_KEY",
  },
};

// Orden por defecto de la cadena de proveedores.
export const DEFAULT_I2V_ORDER = ["nvidia", "openrouter", "fal"];

// Comprueba si un proveedor está habilitado según la configuración.
// NVIDIA: habilitado por defecto (FREE). Se desactiva con i2v_nvidia_enabled=false.
// OpenRouter: deshabilitado por defecto (PREMIUM). Se activa con i2v_openrouter_enabled=true.
// fal.ai: deshabilitado por defecto (PREMIUM). Se activa con i2v_fal_enabled=true.
export function isProviderEnabled(providerId, settings = {}) {
  if (providerId === "nvidia") return settings.i2v_nvidia_enabled !== false;
  if (providerId === "openrouter") return settings.i2v_openrouter_enabled === true;
  if (providerId === "fal") return settings.i2v_fal_enabled === true;
  return false;
}

// Resuelve el proveedor a usar según el modo (auto o explícito).
// Devuelve { primary, chain }:
//   primary — el primer proveedor a intentar (o null si ninguno disponible)
//   chain   — lista ordenada de proveedores habilitados para fallback
export function resolveI2V(settings = {}) {
  const mode = settings.i2v_provider || "auto";
  const order = settings.i2v_provider_order || DEFAULT_I2V_ORDER;

  if (mode !== "auto") {
    // Modo explícito: solo usa el proveedor seleccionado (si está habilitado).
    if (isProviderEnabled(mode, settings)) return { primary: mode, chain: [mode] };
    return { primary: null, chain: [] };
  }

  // AUTO: recorre el orden y habilita los proveedores activos.
  const chain = order.filter((p) => isProviderEnabled(p, settings));
  return { primary: chain[0] || null, chain };
}

// Devuelve la cadena de fallback completa para un hero shot.
// Solo incluye proveedores habilitados, en el orden configurado.
export function getFallbackChain(settings = {}) {
  const order = settings.i2v_provider_order || DEFAULT_I2V_ORDER;
  return order.filter((p) => isProviderEnabled(p, settings));
}