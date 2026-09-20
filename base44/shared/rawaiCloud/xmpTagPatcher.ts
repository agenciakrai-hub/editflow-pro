// RAW AI Studio (cloud) — mismas reglas de parcheo XMP que src/lib/rawaistudio/xmpTagPatcher.js,
// portadas para ejecutarse en el backend (Deno) sin ninguna dependencia del navegador.
// Cualquier corrección hecha aquí debe replicarse también en el archivo del navegador, y
// viceversa — son intencionalmente independientes para no acoplar el flujo local al cloud.

function formatValue(value: any) {
  if (typeof value !== "number") return String(value);
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value > 0 ? `+${formatted}` : formatted;
}

export function setAttribute(xmpText: string, namespace: string, tag: string, value: string) {
  const attrRegex = new RegExp(`(${namespace}:${tag}\\s*=\\s*")([^"]*)(")`);
  if (attrRegex.test(xmpText)) return xmpText.replace(attrRegex, `$1${value}$3`);

  const selfClosing = /<rdf:Description\b([^>]*?)\/>/;
  if (selfClosing.test(xmpText)) {
    return xmpText.replace(selfClosing, `<rdf:Description$1\n   ${namespace}:${tag}="${value}"/>`);
  }
  return xmpText.replace(/(<rdf:Description[^>]*?)(>)/, `$1\n   ${namespace}:${tag}="${value}"$2`);
}

function ensureNamespace(xmpText: string, prefix: string, uri: string) {
  if (new RegExp(`xmlns:${prefix}\\s*=`).test(xmpText)) return xmpText;
  const selfClosing = /<rdf:Description\b([^>]*?)\/>/;
  if (selfClosing.test(xmpText)) {
    return xmpText.replace(selfClosing, `<rdf:Description$1\n   xmlns:${prefix}="${uri}"/>`);
  }
  return xmpText.replace(/(<rdf:Description[^>]*?)(>)/, `$1\n   xmlns:${prefix}="${uri}"$2`);
}

function stripCrsChildElement(xmpText: string, tag: string): string {
  let result = xmpText.replace(new RegExp(`\\s*<crs:${tag}>[^<]*</crs:${tag}>`, "g"), "");
  return result.replace(new RegExp(`\\s*<crs:${tag}\\s*/>`, "g"), "");
}

export function patchXmpAttributes(xmpTemplateText: string, values: Record<string, number>) {
  let result = xmpTemplateText;
  for (const [tag, value] of Object.entries(values || {})) {
    result = stripCrsChildElement(result, tag);
    result = setAttribute(result, "crs", tag, formatValue(value));
  }
  return result;
}

// Traduce el colorLabel interno de la app (ver src/lib/rawaistudio/labels.js) a la etiqueta
// de color que Lightroom espera en xmp:Label. Debe mantenerse igual a la versión del
// navegador (lightroomLabelFor) — mismo mapeo, distinto runtime. Valores en ESPAÑOL:
// Rojo, Amarillo, Verde, Azul, Púrpura.
const LIGHTROOM_LABEL_BY_KEY: Record<string, string> = { none: "", red: "Rojo", yellow: "Amarillo", green: "Verde", blue: "Azul", purple: "Púrpura" };
export function lightroomLabelFor(colorLabel?: string | null) {
  return LIGHTROOM_LABEL_BY_KEY[colorLabel || ""] ?? "Verde";
}

// setXmpProperty — escribe una propiedad XMP simple (xmp:Rating, xmp:Label) como
// ATRIBUTO del rdf:Description principal. Este es el formato que Lightroom reconoce
// de forma fiable al importar el sidecar .xmp: xmp:Rating="5" y xmp:Label="Verde".
//
// Si la propiedad ya existe (como atributo o como elemento hijo), se elimina primero
// para evitar duplicidades y se reescribe como atributo único en el bloque principal.
// Idéntico a src/lib/rawaistudio/xmpTagPatcher.js (versión del navegador).
function setXmpProperty(xmpText: string, tag: string, value: string) {
  // Elimina cualquier forma existente (atributo o elemento hijo) para evitar duplicados.
  let result = xmpText
    .replace(new RegExp(`\\s*xmp:${tag}\\s*=\\s*"[^"]*"`, "g"), "")
    .replace(new RegExp(`\\s*<xmp:${tag}>[^<]*</xmp:${tag}>`, "g"), "")
    .replace(new RegExp(`\\s*<xmp:${tag}\\s*/>`, "g"), "");
  // Escribe como ATRIBUTO en el rdf:Description principal (formato que Lightroom reconoce).
  return setAttribute(result, "xmp", tag, value);
}

export function addRatingAndLabel(xmpText: string, { rating, label }: { rating?: number; label?: string } = {}) {
  let result = ensureNamespace(xmpText, "xmp", "http://ns.adobe.com/xap/1.0/");
  if (rating != null && rating > 0) {
    result = setXmpProperty(result, "Rating", String(rating));
  }
  if (label) {
    result = setXmpProperty(result, "Label", label);
  }
  result = setAttribute(result, "crs", "HasSettings", "True");
  return result;
}

export function addOrientation(xmpText: string, rotation?: number) {
  if (rotation == null || rotation === 0) return xmpText;
  const orientation = rotation === 90 ? "BC" : rotation === 180 ? "XYZ" : rotation === 270 ? "AC" : "AB";
  return setAttribute(xmpText, "crs", "Orientation", orientation);
}

export function validateXmp(
  xmpText: string,
  { rating, label, aiValues, treatment }: { rating?: number; label?: string; aiValues?: Record<string, number> | null; treatment?: string } = {}
) {
  const issues: string[] = [];
  // xmp:Rating como ATRIBUTO en el rdf:Description principal, sin duplicados.
  if (rating != null && rating > 0) {
    if (!new RegExp(`xmp:Rating\\s*=\\s*"${rating}"`).test(xmpText)) issues.push(`xmp:Rating="${rating}" no está presente como atributo en el XMP final`);
    if (new RegExp(`<xmp:Rating>[^<]*</xmp:Rating>`).test(xmpText)) issues.push("xmp:Rating duplicado como elemento hijo — debe ser solo atributo");
  }
  // xmp:Label como ATRIBUTO en el rdf:Description principal, sin duplicados.
  if (label) {
    if (!new RegExp(`xmp:Label\\s*=\\s*"${label}"`).test(xmpText)) issues.push(`xmp:Label="${label}" no está presente como atributo en el XMP final`);
    if (new RegExp(`<xmp:Label>[^<]*</xmp:Label>`).test(xmpText)) issues.push("xmp:Label duplicado como elemento hijo — debe ser solo atributo");
  }
  if (!/crs:HasSettings\s*=\s*"True"/.test(xmpText)) issues.push("crs:HasSettings no está presente en el XMP final — Lightroom ignorará los ajustes");
  for (const [tag, value] of Object.entries(aiValues || {})) {
    const expected = formatValue(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`crs:${tag}\\s*=\\s*"${expected}"`).test(xmpText)) issues.push(`crs:${tag} no se escribió correctamente en el XMP`);
  }
  if (treatment === "monochrome" && !/crs:ConvertToGrayscale\s*=\s*"True"/.test(xmpText)) issues.push("Tratamiento Monocromo solicitado pero crs:ConvertToGrayscale no está en 'True' en el XMP final");
  if (treatment === "color" && /crs:ConvertToGrayscale\s*=\s*"True"/.test(xmpText)) issues.push("Tratamiento Color solicitado pero el XMP final quedó marcado como monocromo (crs:ConvertToGrayscale=True)");
  return { valid: issues.length === 0, issues };
}