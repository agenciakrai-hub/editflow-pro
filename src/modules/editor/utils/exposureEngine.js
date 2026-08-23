// Editor module — IA editing motor (wedding-raw-ai two-layer architecture).
//  Tool 1 (IA, no color): technical baseline (computeTechnicalBaseline from real
//    photometric stats) + contextual IA delta via the rawAiStudioAnalyze backend.
//    Only touches tone/presence/sharpness (Exposure/Contrast/Highlights/Shadows/
//    Whites/Blacks/Vibrance/Saturation/Clarity/Sharpness). Never WB, curves, HSL.
//  Tag names (Lightroom crs) <-> flat keys used by the editor UI.
// CSS preview helpers (adjustmentsToCssFilter / cropToCssTransform) kept intact.
import { base44 } from "@/api/base44Client";
import { analyzePhotometrics } from "@/lib/rawaistudio/photometricAnalysis.js";
import { computeTechnicalBaseline } from "@/lib/rawaistudio/exposureEngine.js";

// Lightroom crs tag -> editor flat key.
const TAG_TO_FLAT = {
  Exposure2012: "exposure",
  Contrast2012: "contrast",
  Highlights2012: "highlights",
  Shadows2012: "shadows",
  Whites2012: "whites",
  Blacks2012: "blacks",
  Vibrance: "vibrance",
  Saturation: "saturation",
  Clarity2012: "clarity",
  Sharpness: "sharpness",
};

const ENABLED_TAGS = Object.keys(TAG_TO_FLAT);

async function urlToBase64(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Core IA develop layer from a preview base64 (local files — no URL fetch).
// Returns ONLY the 10 flat tone/presence/sharpness keys — never temperature/tint/color.
export async function computeAutoAdjustmentsFromBase64(base64, precisionMode = "balanced") {
  const out = {};
  if (!base64) return out;
  try {
    const stats = await analyzePhotometrics(base64);
    const baseline = computeTechnicalBaseline(stats, precisionMode);
    const res = await base44.functions.invoke("rawAiStudioAnalyze", {
      photos: [{ id: "local", preview_base64: base64, baseline: baseline.values, technical_confidence: baseline.confidence }],
      enabled_params: ENABLED_TAGS,
      preferences: {},
      precision_mode: precisionMode,
    });
    const data = res?.data ?? res;
    const vals = data?.results?.["local"] || {};
    for (const [tag, flat] of Object.entries(TAG_TO_FLAT)) {
      if (typeof vals[tag] === "number") out[flat] = vals[tag];
    }
  } catch {
    // On failure, leave adjustments untouched (no fallback heuristic).
  }
  return out;
}

// Convenience wrapper for photos with a remote URL (legacy editor flow).
export async function computeAutoAdjustments(photo, precisionMode = "balanced") {
  const url = photo?.file_url || photo?.thumbnail_url;
  const base64 = url ? await urlToBase64(url) : null;
  return computeAutoAdjustmentsFromBase64(base64, precisionMode);
}

// CSS filter approximation for the before/after preview. Lightroom's tone
// curve, HSL, grading etc. have no direct CSS equivalent, so this is an
// approximation of the develop settings that DO map to CSS filters.
export function adjustmentsToCssFilter(a = {}) {
  const brightness = 1 + (a.exposure ?? 0) / 200;
  const contrast = 1 + (a.contrast ?? 0) / 200 + (a.clarity ?? 0) / 400 + (a.dehaze ?? 0) / 500 + (a.texture ?? 0) / 600;
  const saturate = Math.max(0, 1 + (a.vibrance ?? 0) / 150 + (a.saturation ?? 0) / 200);
  const warmth = (a.temperature ?? 0);
  const sepia = Math.max(0, warmth) / 400;
  const hue = (a.tint ?? 0) / 8 + (a.grading?.highlightsHue ? Math.sin((a.grading.highlightsHue * Math.PI) / 180) * 6 : 0);
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia}) hue-rotate(${hue}deg)`;
}

// CSS transform for the crop/straighten tools (rotate + flip + scale).
export function cropToCssTransform(crop = {}) {
  if (!crop) return "none";
  const angle = (crop.angle ?? 0) + (crop.rotate ?? 0);
  const flipX = crop.flipH ? -1 : 1;
  const flipY = crop.flipV ? -1 : 1;
  const scaleX = flipX * (1 + (crop.right ?? 0) / -200 + (crop.left ?? 0) / -200);
  const scaleY = flipY * (1 + (crop.top ?? 0) / -200 + (crop.bottom ?? 0) / -200);
  if (!angle && flipX === 1 && flipY === 1 && scaleX === 1 && scaleY === 1) return "none";
  return `rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;
}