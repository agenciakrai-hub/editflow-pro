// Creador de estilos — convierte un PhotographerStyleProfile en una PLANTILLA XMP
// creativa (capa base del pipeline de AjustesIA). 100 % determinista, sin IA, sin red.
//
// La plantilla contiene EXCLUSIVAMENTE sliders creativos (Vibrance, Saturation,
// Clarity2012, Texture2012, Dehaze2012, Sharpness). NUNCA Exposure2012, Contrast2012,
// Highlights2012, Shadows2012, Whites2012, Blacks2012, Temperature ni Tint — esos
// pertenecen al motor técnico de AjustesIA y se calculan por fotografía.
//
// La plantilla entra en el slot `presetTemplateText` de AjustesIA: el motor parchea
// los 6 básicos (patchXmpAttributes) y el WB (writeWhiteBalance) POR ENCIMA de ella,
// respetando el look creativo del perfil. No se toca xmpTagPatcher ni ningún motor.

const CREATIVE_TAGS = ["Vibrance", "Saturation", "Clarity2012", "Texture2012", "Dehaze2012", "Sharpness"];
const FORBIDDEN = ["Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012", "Temperature", "Tint"];

function formatValue(value) {
  const f = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value > 0 ? `+${f}` : f;
}

// Devuelve true si la receta NO contiene ningún básico técnico (válida como capa creativa).
export function isCreativeOnly(recipe) {
  if (!recipe || typeof recipe !== "object") return true;
  return FORBIDDEN.every((k) => recipe[k] == null || typeof recipe[k] !== "number");
}

// Genera la plantilla XMP creativa a partir del creative_recipe del perfil.
export function styleProfileToXmpTemplate(profile) {
  const recipe = profile?.creative_recipe || {};
  // Guard defensivo: nunca emitir básicos aunque la receta los contenga.
  const attrs = [];
  for (const tag of CREATIVE_TAGS) {
    const v = recipe[tag];
    if (typeof v === "number" && Number.isFinite(v)) {
      attrs.push(`crs:${tag}="${formatValue(v)}"`);
    }
  }
  const attrStr = attrs.length ? "\n   " + attrs.join("\n   ") : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"${attrStr}/>
  </rdf:RDF>
</x:xmpmeta>`;
}