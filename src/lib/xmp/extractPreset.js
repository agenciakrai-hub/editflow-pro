import { readTagValue } from "@/lib/xmp/XmpPatchEngine";

// Extrae los valores numéricos de revelado directamente de un preset de Lightroom
// (.xmp). Devuelve un mapa { TagName: string } listo para patchDevelopTags, de modo
// que los XMP exportados lleven los parámetros EXACTOS del preset del estilo — no una
// reinterpretación generada por la IA a partir del ADN cualitativo.

const PRESET_TAGS = [
  "Exposure2012",
  "Contrast2012",
  "Highlights2012",
  "Shadows2012",
  "Whites2012",
  "Blacks2012",
  "Tint",
  "Vibrance",
  "Saturation",
  "Sharpness",
  "Temperature",
];

export function extractTagValuesFromPresetXmp(xmpText) {
  const tagValues = {};
  for (const tag of PRESET_TAGS) {
    const v = readTagValue(xmpText, tag);
    if (v !== null && v !== "" && Number.isFinite(Number(v))) tagValues[tag] = String(v);
  }
  return tagValues;
}

// Descarga un preset subido (file_url) y devuelve sus tag values, o null si no es un
// XMP de preset válido / no contiene parámetros de revelado.
export async function fetchPresetTagValues(presetUrl) {
  const res = await fetch(presetUrl);
  if (!res.ok) return null;
  const text = await res.text();
  const tagValues = extractTagValuesFromPresetXmp(text);
  return Object.keys(tagValues).length ? tagValues : null;
}