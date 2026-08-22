import { base44 } from "@/api/base44Client";

// Genera una receta de revelado (preset_data) a partir del ADN de un StyleProfile,
// usando las muestras editadas del estilo como ancla visual. Es el equivalente
// client-side de analyzeScene (base44/shared/editingEngine.ts) pero sin representantes
// de escena: produce UNA receta para aplicar el estilo a toda la sesión.

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    exposure: { type: "number", description: "EV adjustment, roughly -2 to 2" },
    contrast: { type: "number", description: "-100 to 100" },
    highlights: { type: "number", description: "-100 to 100" },
    shadows: { type: "number", description: "-100 to 100" },
    whites: { type: "number", description: "-100 to 100" },
    blacks: { type: "number", description: "-100 to 100" },
    temperature: { type: "number", description: "Kelvin shift, roughly -100 to 100" },
    tint: { type: "number", description: "-100 to 100" },
    vibrance: { type: "number", description: "-100 to 100" },
    saturation: { type: "number", description: "-100 to 100" },
    sharpening: { type: "number", description: "0 to 100" },
    confidence: { type: "number", description: "0 to 1, how confident the recipe matches the requested style" },
    notes: { type: "string", description: "Short explanation of the editing decisions" }
  },
  required: ["exposure", "contrast", "temperature", "tint", "confidence"]
};

const SKIN_TONE_TEXT = { warm: "warm, golden skin tones", natural: "true-to-life, natural skin tones", cool: "cool, neutral skin tones" };
const CONTRAST_TEXT = { low: "low contrast, soft tonal range", medium: "medium, balanced contrast", high: "high, punchy contrast" };
const GREENS_TEXT = { intense: "intense, saturated greens", natural: "natural, true-to-life greens", muted: "muted, desaturated greens" };
const SKY_TEXT = { dramatic: "dramatic, moody skies", natural: "natural, true-to-life skies", bright: "bright, airy skies" };
const DRESS_TEXT = { natural: "keep the wedding dress's whites natural, do not saturate it", boosted: "boosted saturation on the dress is acceptable" };
const CONSISTENCY_TEXT = { low: "some variation between photos is fine", medium: "moderate consistency across photos", high: "very high consistency across all photos in this scene" };

function buildPromptFromStyle(styleProfile) {
  const dna = styleProfile?.style_dna || {};
  const lines = [
    `Style to match: ${styleProfile?.name || "Natural"} (v${styleProfile?.version || 1})`,
    styleProfile?.description ? `Photographer's description: ${styleProfile.description}` : null,
    dna.summary ? `Learned style summary: ${dna.summary}` : null,
    `Skin tones: ${SKIN_TONE_TEXT[dna.skin_tone] || SKIN_TONE_TEXT.natural}`,
    `Contrast: ${CONTRAST_TEXT[dna.contrast] || CONTRAST_TEXT.medium}`,
    `Greens: ${GREENS_TEXT[dna.greens] || GREENS_TEXT.natural}`,
    `Sky: ${SKY_TEXT[dna.sky] || SKY_TEXT.natural}`,
    `Wedding dress: ${DRESS_TEXT[dna.dress_saturation] || DRESS_TEXT.natural}`,
    dna.skin_priority !== false ? "Prioritize skin rendering over other elements when there's a tradeoff." : null,
    `Consistency: ${CONSISTENCY_TEXT[dna.consistency] || CONSISTENCY_TEXT.high}`
  ].filter(Boolean);
  return lines.join("\n");
}

export async function generateStyleRecipe(styleProfile) {
  const fileUrls = (styleProfile?.edited_sample_images || []).slice(0, 3).filter(Boolean);

  const prompt = `You are a professional wedding photo colorist working like Adobe Lightroom / Camera Raw.
You ONLY reveal photographs — you NEVER generate, edit, retouch, reconstruct or alter any content.
People's identity is sacred and must never change: faces, eyes, nose, mouth, hair, expression,
hands, anatomy, clothing, jewellery and background must remain exactly as captured. You do not
remove blemishes, swap skies, generate or inpixel anything. The only thing you produce is a set of
global develop settings (exposure, contrast, tone, white balance, color), exactly like a Lightroom
preset / XMP sidecar, that will be applied non-destructively to the original file.

${fileUrls.length ? "Look at the attached samples of the photographer's edited style." : "Based on the described style."}
Produce ONE develop recipe (a Lightroom preset) to apply to every photo in the session, matching this target look:

${buildPromptFromStyle(styleProfile)}

Return concrete numeric develop parameters that achieve this look. Output ONLY the
global develop sliders below — never any content-altering operation.`;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    ...(fileUrls.length ? { file_urls: fileUrls } : {}),
    response_json_schema: RECIPE_SCHEMA
  });

  const { confidence, notes, ...preset_data } = result;
  return { preset_data, confidence: confidence ?? 0, notes: notes || "" };
}