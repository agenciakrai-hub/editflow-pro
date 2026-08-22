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
// de color estándar que Lightroom espera en xmp:Label. Debe mantenerse igual a la versión
// del navegador (lightroomLabelFor) — mismo mapeo, distinto runtime.
const LIGHTROOM_LABEL_BY_KEY: Record<string, string> = { none: "", red: "Red", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple" };
export function lightroomLabelFor(colorLabel?: string | null) {
  return LIGHTROOM_LABEL_BY_KEY[colorLabel || ""] ?? "Green";
}

// setXmpProperty — escribe una propiedad XMP simple (xmp:Rating, xmp:Label) en
// CUALQUIERA de las dos formas que Lightroom usa en sus sidecars .xmp:
//   1. Elemento hijo: <xmp:Tag>valor</xmp:Tag>  (forma habitual en sidecars de foto)
//   2. Atributo:      xmp:Tag="valor"            (forma habitual en presets de Develop)
// Si la propiedad ya existe en cualquiera de las dos formas, se reemplaza el valor
// existente. Si no existe, se añade como atributo en el primer rdf:Description.
//
// Esto es CRÍTICO: setAttribute solo maneja atributos, pero los sidecars .xmp de
// Lightroom suelen escribir xmp:Label como ELEMENTO HIJO. Si el template tiene
// <xmp:Label>Red</xmp:Label> y añadimos xmp:Label="Green" como atributo, Lightroom
// lee el elemento hijo (Red) e ignora el atributo (Green) — el verde nunca aparece.
// Idéntico a src/lib/rawaistudio/xmpTagPatcher.js (versión del navegador).
function setXmpProperty(xmpText: string, tag: string, value: string) {
  // 1. Elemento hijo con contenido: <xmp:Tag>old</xmp:Tag> → reemplazar texto.
  const elemRegex = new RegExp(`(<xmp:${tag}>)([^<]*)(</xmp:${tag}>)`);
  if (elemRegex.test(xmpText)) return xmpText.replace(elemRegex, `$1${value}$3`);
  // 2. Elemento hijo autocerrado: <xmp:Tag/> → convertir en elemento con contenido.
  const selfCloseRegex = new RegExp(`<xmp:${tag}\\s*/>`);
  if (selfCloseRegex.test(xmpText)) return xmpText.replace(selfCloseRegex, `<xmp:${tag}>${value}</xmp:${tag}>`);
  // 3. Atributo: xmp:Tag="old" → reemplazar valor.
  const attrRegex = new RegExp(`(xmp:${tag}\\s*=\\s*")([^"]*)(")`);
  if (attrRegex.test(xmpText)) return xmpText.replace(attrRegex, `$1${value}$3`);
  // 4. No existe → añadir como atributo en rdf:Description.
  return setAttribute(xmpText, "xmp", tag, value);
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
  // Comprueba AMBAS formas (atributo y elemento hijo) porque Lightroom puede escribir
  // xmp:Label y xmp:Rating de cualquiera de las dos maneras en sus sidecars .xmp.
  const hasRating = rating != null && rating > 0 && (
    new RegExp(`xmp:Rating\\s*=\\s*"${rating}"`).test(xmpText) || new RegExp(`<xmp:Rating>${rating}</xmp:Rating>`).test(xmpText)
  );
  if (rating != null && rating > 0 && !hasRating) issues.push("xmp:Rating no está presente en el XMP final");
  const hasLabel = label && (
    new RegExp(`xmp:Label\\s*=\\s*"${label}"`).test(xmpText) || new RegExp(`<xmp:Label>${label}</xmp:Label>`).test(xmpText)
  );
  if (label && !hasLabel) issues.push("xmp:Label no está presente en el XMP final");
  if (!/crs:HasSettings\s*=\s*"True"/.test(xmpText)) issues.push("crs:HasSettings no está presente en el XMP final — Lightroom ignorará los ajustes");
  for (const [tag, value] of Object.entries(aiValues || {})) {
    const expected = formatValue(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`crs:${tag}\\s*=\\s*"${expected}"`).test(xmpText)) issues.push(`crs:${tag} no se escribió correctamente en el XMP`);
  }
  if (treatment === "monochrome" && !/crs:ConvertToGrayscale\s*=\s*"True"/.test(xmpText)) issues.push("Tratamiento Monocromo solicitado pero crs:ConvertToGrayscale no está en 'True' en el XMP final");
  if (treatment === "color" && /crs:ConvertToGrayscale\s*=\s*"True"/.test(xmpText)) issues.push("Tratamiento Color solicitado pero el XMP final quedó marcado como monocromo (crs:ConvertToGrayscale=True)");
  return { valid: issues.length === 0, issues };
}