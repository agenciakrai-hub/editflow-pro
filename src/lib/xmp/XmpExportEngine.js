// XmpExportEngine — independent of the Develop Engine and the local agent. Its only
// responsibility: a SceneRecipe's preset → an Adobe Lightroom / Camera Raw XMP sidecar.
//
// Purpose: a fast product-validation path. The user drops the generated .xmp files
// next to their RAWs and opens Lightroom to confirm the recipe applies correctly.
// This never edits images and is NOT part of the deterministic develop path.

// KRFC0056.CR3 → KRFC0056.xmp (same base name as the RAW, .xmp extension).
export const toXmpName = (rawName) => {
  const base = (rawName || "").replace(/\.[^.]+$/, "");
  return `${base || rawName || "photo"}.xmp`;
};

// Lightroom XMP stores white balance as absolute Kelvin. Our recipe stores a Kelvin
// *shift* (roughly -100..100). For this validation export we anchor at 5500K (daylight)
// and scale the shift so Lightroom shows a sensible WB to verify.
const temperatureToKelvin = (shift) => 5500 + Math.round((Number(shift) || 0) * 50);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Builds an XMP sidecar string from a SceneRecipe. `recipe.preset_data` holds the
// develop sliders produced by the AI analysis (see shared/editingEngine.ts).
export function buildXmp(recipe) {
  const p = recipe?.preset_data || {};
  const exposure = num(p.exposure);
  const contrast = num(p.contrast);
  const highlights = num(p.highlights);
  const shadows = num(p.shadows);
  const whites = num(p.whites);
  const blacks = num(p.blacks);
  const temperature = temperatureToKelvin(p.temperature);
  const tint = num(p.tint);
  const vibrance = num(p.vibrance);
  const saturation = num(p.saturation);
  const sharpening = num(p.sharpening);

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Wedding RAW AI">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
      <crs:AlreadyApplied>False</crs:AlreadyApplied>
      <crs:Version>15.0</crs:Version>
      <crs:ProcessVersion>15.0</crs:ProcessVersion>
      <crs:Exposure2012>${exposure}</crs:Exposure2012>
      <crs:Contrast2012>${contrast}</crs:Contrast2012>
      <crs:Highlights2012>${highlights}</crs:Highlights2012>
      <crs:Shadows2012>${shadows}</crs:Shadows2012>
      <crs:Whites2012>${whites}</crs:Whites2012>
      <crs:Blacks2012>${blacks}</crs:Blacks2012>
      <crs:Temperature>${temperature}</crs:Temperature>
      <crs:Tint>${tint}</crs:Tint>
      <crs:Vibrance>${vibrance}</crs:Vibrance>
      <crs:Saturation>${saturation}</crs:Saturation>
      <crs:Sharpness>${sharpening}</crs:Sharpness>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}