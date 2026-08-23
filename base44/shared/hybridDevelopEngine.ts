// Motor de Revelado Híbrido — FASE DE PERFIL (backend).
// La IA analiza SOLO K fotos representativas de la sesión (una sola llamada Vision) y
// genera un PERFIL DE SESION: un recipe base de revelado coherente (look de sesión) más
// una descripción de la luz/mood detectados. El motor LOCAL (src/lib/rawaistudio/
// hybridAdaptEngine.js) aplica y adapta ese perfil a CADA foto usando fotometría real
// (exposición/luces/sombras por foto), sin más llamadas de IA.
//
// Arquitectura: N fotos → K representantes (K << N) → 1 llamada IA → perfil → adaptación
// local por foto. Económico: consumo de IA proporcional al nº de escenas, no al total.
//
// Proveedor: el activo para "ajustes" (gemini/qwen/nvidia). Las previews van como data
// URLs directas — sin UploadFile ni InvokeLLM Base44 (los créditos de integración pueden
// estar agotados). Si no hay proveedor externo configurado, se fuerza Qwen.

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
  Clarity2012: { min: -100, max: 100 },
  Sharpness: { min: 0, max: 100 },
};

export const PROFILE_KEYS = Object.keys(RANGES);

const clamp = (key: string, value: number): number => {
  const r = RANGES[key];
  return Math.min(r.max, Math.max(r.min, value));
};

// representatives: [{ id, preview_base64 }]  (K << N)
// Devuelve { base_recipe: { [key]: number }, analysis: string, confidence: number }
export async function generateSessionProfile(
  base44: any,
  representatives: Array<{ id: string; preview_base64: string }>,
  preferences: Record<string, number> = {}
): Promise<{ base_recipe: Record<string, number>; analysis: string; confidence: number }> {
  if (!representatives?.length) throw new Error("representatives requerido (min 1 preview)");

  const file_urls = representatives.map((r) => `data:image/jpeg;base64,${r.preview_base64}`);

  const propList = PROFILE_KEYS.map((k) => {
    const r = RANGES[k];
    return `- ${k}: numero entre ${r.min} y ${r.max}`;
  }).join("\n");

  const prompt = `Eres un colorista profesional que revela fotos en Adobe Lightroom / Camera Raw, especializado en bodas y retrato.
SOLO revelas — nunca generas ni alteras pixeles, identidad, anatomia, ropa ni fondo.

Te muestro ${representatives.length} fotos REPRESENTATIVAS de una misma sesion fotografica (mismo evento, mismo estilo, misma luz general). Tu trabajo NO es revelarlas una a una: es definir un PERFIL DE SESION unico, un recipe base de revelado coherente que un motor local aplicara y adaptara despues a CADA foto de la sesion (corrigiendo exposicion/luces/sombras por foto segun su histograma real).

PRIORIDAD ABSOLUTA: si hay personas, su piel y rostros deben quedar bien expuestos, con color de piel natural y sano. Optimiza para CONSISTENCIA entre tomas (look de sesion) mas que para el gusto variable de una sola foto.

Analiza el tipo de luz dominante (ventana, contraluz, lateral, flash, exterior), la paleta de color y el mood, y decide un recipe base profesional para:
${propList}

Los valores Exposure2012/Highlights2012/Shadows2012/Whites2012/Blacks2012 seran el PUNTO DE PARTIDA que el motor local refinara por foto (aportan la direccion general de la sesion). Contrast2012/Temperature/Tint/Vibrance/Saturation/Clarity2012/Sharpness seran aplicados de forma UNIFORME a toda la sesion (look creativo coherente).

No inventes valores fuera de rango. No toques curvas de tono, HSL, calibracion de camara ni mascaras — solo los sliders listados.

Devuelve un JSON con las claves exactas listadas, mas "analysis" (frase corta describiendo luz y mood detectados) y "confidence_score" (0-100).`;

  const properties: Record<string, any> = {};
  for (const k of PROFILE_KEYS) properties[k] = { type: "number" };
  properties.analysis = { type: "string" };
  properties.confidence_score = { type: "number" };
  const schema = { type: "object", properties, required: [...PROFILE_KEYS, "analysis", "confidence_score"] };

  // Proveedor externo segun active_ajustes; si no hay ninguno, se fuerza Qwen. Nunca cae
  // a Base44/InvokeLLM: las previews van como data URLs directas.
  let provider = await activeProviderFor(base44, "ajustes");
  if (provider !== "qwen" && provider !== "gemini" && provider !== "nvidia") provider = "qwen";
  const result = await invokeVision(base44, {
    task: "ajustes",
    prompt,
    file_urls,
    response_json_schema: schema,
    forceProvider: provider,
  } as any);

  const base_recipe: Record<string, number> = {};
  for (const k of PROFILE_KEYS) {
    const pref = Number(preferences?.[k]) || 0;
    const raw = typeof result[k] === "number" ? result[k] : 0;
    base_recipe[k] = clamp(k, raw + pref);
  }
  const analysis = typeof result.analysis === "string" ? result.analysis : "";
  const confidence =
    typeof result.confidence_score === "number" ? Math.min(100, Math.max(0, result.confidence_score)) : 80;
  return { base_recipe, analysis, confidence };
}