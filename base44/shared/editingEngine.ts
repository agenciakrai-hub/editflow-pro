// AI Style Analysis: sends a scene's representative images — together with the AI
// context built from the job's Style (visual goals + knowledge) — to the AI and
// gets back the develop recipe that becomes that scene's SceneRecipe. This is the
// analysis step only — actually applying a recipe to an image is
// ImageProcessingEngine's job (see shared/imageProcessing/), which every component
// must go through instead of talking to a provider directly.
export const ENGINE_PROVIDER = "gemini_3_flash";
export const ENGINE_VERSION = "0.4.0";

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

// The prompt is never hand-written by the photographer and never stored on the
// Style — it's always derived from the Style's DNA (learned once from the
// photographer's edited samples), so the underlying AI model/provider can change
// without invalidating the Style itself.
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

// styleProfile is the reusable, versioned Style entity — its visual goals and
// knowledge (not a raw prompt) are what drive the AI context for every project it's used on.
export async function analyzeScene(base44, representativeImages, styleProfile) {
  const fileUrls = representativeImages.map((image) => image.original_url).filter(Boolean);
  // A few of the style's own edited samples, as a visual anchor for its DNA.
  const styleSamples = (styleProfile?.edited_sample_images || []).slice(0, 3);
  if (styleSamples.length) fileUrls.push(...styleSamples);

  const prompt = `You are a professional wedding photo colorist working like Adobe Lightroom / Camera Raw.
You ONLY reveal photographs — you NEVER generate, edit, retouch, reconstruct or alter any content.
People's identity is sacred and must never change: faces, eyes, nose, mouth, hair, expression,
hands, anatomy, clothing, jewellery and background must remain exactly as captured. You do not
remove blemishes, swap skies, generate or inpixel anything. The only thing you produce is a set of
global develop settings (exposure, contrast, tone, white balance, color), exactly like a Lightroom
preset / XMP sidecar, that will be applied non-destructively to the original file.

Look at the attached representative photographs from a single lighting scene of a wedding
shoot${styleSamples.length ? " and the attached samples of the photographer's edited style" : ""}.
Produce ONE develop recipe (a Lightroom preset) to apply to every photo in this scene, matching this target look:

${buildPromptFromStyle(styleProfile)}

Return concrete numeric develop parameters that achieve this look on these photos. Output ONLY the
global develop sliders below — never any content-altering operation.`;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    file_urls: fileUrls,
    response_json_schema: RECIPE_SCHEMA
  });

  const { confidence, notes, ...preset_data } = result;
  return { preset_data, confidence: confidence ?? 0, notes: notes || "" };
}