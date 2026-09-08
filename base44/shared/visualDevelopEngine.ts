// Motor de Revelado IA Visual — la IA decide los ajustes de revelado COMPLETOS de
// Lightroom analizando el CONTENIDO de la foto (sujeto, luz, color, mood), no solo el
// histograma. Sin baseline técnico acotado: la IA devuelve valores absolutos profesionales.
//
// Proveedor: SIEMPRE el activo por herramienta AJUSTES (elegido en Proveedores IA), vía
// invokeVision. Las previews se envían como data URLs
// (data:image/jpeg;base64,...) directamente al endpoint OpenAI-compatible de DashScope —
// SIN UploadFile (evita el bloqueo de créditos de integración Base44 y la subida de red).
//
// No toca balance de blancos con valores absolutos fuera de rango, curvas, HSL, calibración
// de cámara ni máscaras — solo los sliders de revelado listados. La preferencia del
// fotógrafo se SUMA a la decisión de la IA (0 = sin desplazar).

import { invokeVision, activeProviderFor } from "./aiProviderAdapter.ts";

const RANGES: Record<string, { min: number; max: number }> = {
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
  Texture2012: { min: -100, max: 100 },
  Clarity2012: { min: -100, max: 100 },
  Dehaze2012: { min: -100, max: 100 },
  Sharpness: { min: 0, max: 100 },
};

export const VISUAL_PARAM_KEYS = Object.keys(RANGES);

const clamp = (key: string, value: number): number => {
  const r = RANGES[key];
  return Math.min(r.max, Math.max(r.min, value));
};

export async function developPhotoVisual(
  base44: any,
  previewBase64: string,
  preferences: Record<string, number> = {}
): Promise<{ values: Record<string, number>; confidence: number | null }> {
  if (!previewBase64) throw new Error("preview_base64 requerido");
  const dataUrl = `data:image/jpeg;base64,${previewBase64}`;

  const propList = VISUAL_PARAM_KEYS.map((k) => {
    const r = RANGES[k];
    return `- ${k}: numero entre ${r.min} y ${r.max}`;
  }).join("\n");

  const prompt = `Eres un colorista profesional que revela fotos en Adobe Lightroom / Camera Raw, especializado en fotografia de bodas y retrato.
SOLO revelas la fotografia — nunca generas, retocas ni alteras pixeles, identidad, anatomia, ropa ni fondo.

Analiza el CONTENIDO de esta foto: sujeto principal, tipo de luz (ventana, contraluz, lateral, flash), ambiente, paleta de color, contraste y mood. Decide los ajustes de revelado COMPLETOS como lo haria un experto MIRANDO la imagen — no solo el histograma.

PRIORIDAD ABSOLUTA: si hay personas, SU piel y rostros deben quedar bien expuestos, con contraste natural y color de piel sano y natural, antes que cualquier otra zona — aunque el fondo quede sobre/subexpuesto. Solo si no hay personas, optimiza la escena global.

Devuelve valores tecnicamente correctos y profesionales para:
${propList}
- confidence_score: 0-100, confianza en que los sujetos importantes quedan bien revelados.

No inventes valores fuera de rango. No toques curvas de tono, HSL, calibracion de camara ni mascaras — solo los sliders listados.

Devuelve un JSON con las claves exactas listadas mas confidence_score.`;

  const properties: Record<string, any> = {};
  for (const k of VISUAL_PARAM_KEYS) properties[k] = { type: "number" };
  properties.confidence_score = { type: "number" };
  const schema = {
    type: "object",
    properties,
    required: [...VISUAL_PARAM_KEYS, "confidence_score"],
  };

  // Proveedor activo por herramienta AJUSTES (Proveedores IA): el modelo que el
  // administrador eligió analiza y edita la foto — SIEMPRE, sin sustitución silenciosa.
  // Si no hay proveedor externo configurado se lanza un error claro (nunca cae a Qwen,
  // Base44 ni InvokeLLM por su cuenta). La preview va como data URL directa.
  const provider = await activeProviderFor(base44, "ajustes");
  const isExternal = provider === "qwen" || provider === "gemini" || provider === "nvidia" || String(provider).startsWith("custom:");
  if (!isExternal) {
    throw new Error("No hay proveedor activo para Ajustes IA. Selecciona el 'Proveedor activo por herramienta — AJUSTES' en Proveedores IA: IA Visual usa SIEMPRE ese modelo.");
  }
  const result = await invokeVision(base44, {
    task: "ajustes",
    prompt,
    file_urls: [dataUrl],
    response_json_schema: schema,
    forceProvider: provider,
  } as any);

  const values: Record<string, number> = {};
  for (const k of VISUAL_PARAM_KEYS) {
    const pref = Number(preferences?.[k]) || 0;
    const raw = typeof result[k] === "number" ? result[k] : 0;
    values[k] = clamp(k, raw + pref);
  }
  const confidence =
    typeof result.confidence_score === "number"
      ? Math.min(100, Math.max(0, result.confidence_score))
      : 80;
  return { values, confidence };
}