// Motor KR Auto — núcleo de inteligencia del producto.
// Analiza cada fotografía y calcula ajustes TÉCNICOS de nivelado (exposición/tono).
// Toda la inteligencia vive aquí: el plugin solo envía la imagen y recibe los
// parámetros. Mejorar el algoritmo (prompt, modelo, reglas) no requiere tocar el plugin.
//
// Usa el AI gateway de Base44 (generateObject + esquema Zod) para que la salida
// sea siempre los 5 parámetros técnicos, nunca otra cosa.
// NUNCA sugiere balance de blancos, curvas, HSL, calibración, máscaras ni estilo.

import { generateObject } from "npm:ai@7.0.16";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible@3.0.5";
import { z } from "npm:zod@4.4.3";

export const MOTOR_VERSION = "1.0.0";
export const MOTOR_MODEL = "gemini_3_flash";

const TECHNICAL_SCHEMA = z.object({
  Exposure2012: z.number().describe("EV -1.5 to +1.5"),
  Highlights2012: z.number().describe("-100 to 0"),
  Shadows2012: z.number().describe("0 to +100"),
  Whites2012: z.number().describe("-100 to +100"),
  Blacks2012: z.number().describe("-100 to +100"),
});

const MOTOR_PROMPT = `You are KR Auto, a TECHNICAL leveling engine for wedding photography RAW files.

Analyze this photo's exposure and tonal balance. Compute ONLY base technical
adjustments — the photographer will apply their own artistic presets on top.
You must NOT impose any creative or artistic style.

Return exactly these 5 Camera Raw / Lightroom develop parameters:

- Exposure2012 (range -1.5 to +1.5 EV):
  Positive brightens, negative darkens. Bring the exposure toward a balanced
  midtone. If the photo is underexposed (too dark), increase. If overexposed
  (too bright), decrease. A well-exposed photo should get a value near 0.

- Highlights2012 (range -100 to 0):
  Negative values recover blown or overly bright highlights. Use 0 if
  highlights are not clipped or blown.

- Shadows2012 (range 0 to +100):
  Positive values lift crushed or very dark shadows to reveal detail. Use 0
  if shadows already have good detail.

- Whites2012 (range -100 to +100):
  Negative reduces white-point clipping. Small positive opens whites slightly.
  Keep values small (around ±10).

- Blacks2012 (range -100 to +100):
  Positive lifts deep blacks for detail. Negative deepens. Keep values small
  (around ±10).

STRICT RULES:
- ONLY exposure and tone adjustments. NEVER include or suggest: white balance
  (Temperature/Tint), tone curves, HSL, color calibration, camera profiles, or masks.
- Be conservative: prefer subtle adjustments. The goal is a clean, neutral
  technical base — not a stylized look.
- If the photo is already well-exposed and balanced, return values close to 0.
- Return numbers only. No text, no explanations, no units.`;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v) {
  return Math.round(v * 100) / 100;
}

// imageRef: data: URL (data:image/jpeg;base64,...) or a regular URL.
// base44: the client from createClientFromRequest (provides asServiceRole.aiGateway).
export async function analyzePhoto(base44, imageRef) {
  const { baseURL, token } = base44.asServiceRole.aiGateway.connection();
  const models = createOpenAICompatible({
    name: "base44",
    baseURL,
    apiKey: token,
    supportsStructuredOutputs: true,
  });

  const { object } = await generateObject({
    model: models(MOTOR_MODEL),
    schema: TECHNICAL_SCHEMA,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: MOTOR_PROMPT },
          { type: "image", image: imageRef },
        ],
      },
    ],
  });

  return {
    Exposure2012: round2(clamp(object.Exposure2012, -1.5, 1.5)),
    Highlights2012: round2(clamp(object.Highlights2012, -100, 0)),
    Shadows2012: round2(clamp(object.Shadows2012, 0, 100)),
    Whites2012: round2(clamp(object.Whites2012, -100, 100)),
    Blacks2012: round2(clamp(object.Blacks2012, -100, 100)),
  };
}