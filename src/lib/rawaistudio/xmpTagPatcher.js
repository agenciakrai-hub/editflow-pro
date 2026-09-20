// RAW AI Studio — generador de XMP. Parte de la plantilla del preset del fotógrafo
// y modifica ÚNICAMENTE los atributos correspondientes a los parámetros que la IA
// calculó (crs:) más el rating/color de selección (xmp:); todo lo demás en la
// plantilla permanece byte a byte intacto.

// Adobe siempre escribe el signo explícito en los sliders de revelado con signo
// (crs:Exposure2012="+0.15", crs:Contrast2012="+8"...). Si el valor IA se escribiera sin el
// "+" no sería inválido para Lightroom, pero rompería la comparación byte a byte con el
// resto de atributos del mismo preset, que sí lo llevan.
function formatValue(value) {
  if (typeof value !== "number") return String(value);
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value > 0 ? `+${formatted}` : formatted;
}

// Inserta o reemplaza un atributo en el primer <rdf:Description>, sin romper la etiqueta
// cuando esta es autocerrada (<rdf:Description .../>) — un bug anterior insertaba el
// atributo DESPUÉS de la barra de cierre, generando XML corrupto en esos presets
// (frecuente en algunos exports de cámara, incluyendo varios flujos Leica).
export function setAttribute(xmpText, namespace, tag, value) {
  // CAMINO 1: el atributo ya existe en el XMP → se reemplaza in situ (comportamiento original).
  const attrRegex = new RegExp(`(${namespace}:${tag}\\s*=\\s*")([^"]*)(")`);
  if (attrRegex.test(xmpText)) return xmpText.replace(attrRegex, `$1${value}$3`);

  // CAMINO 2: el atributo no existe → se añade a la rdf:Description PRINCIPAL (la que
  // contiene rdf:about=""), garantizando primero el namespace correspondiente. Esto
  // corrige el bug por el que, en presets con múltiples rdf:Description, los atributos
  // crs:* (Exposure2012, Contrast2012, ... HasSettings) se escribían en la PRIMERA
  // descripción aunque esta no tuviera xmlns:crs, generando XML que Lightroom no podía
  // interpretar correctamente.
  const NS_URIS = {
    crs: "http://ns.adobe.com/camera-raw-settings/1.0/",
    xmp: "http://ns.adobe.com/xap/1.0/",
    photoshop: "http://ns.adobe.com/photoshop/1.0/",
  };
  let result = xmpText;
  const nsUri = NS_URIS[namespace];
  if (nsUri) result = ensureNamespace(result, namespace, nsUri);
  const bounds = mainDescriptionBounds(result);
  if (!bounds) return result;
  const opening = result.slice(bounds.openStart, bounds.openEnd);
  if (bounds.selfClosing) {
    const newOpening = opening.replace(/\/\s*>$/, `\n   ${namespace}:${tag}="${value}"/>`);
    return result.slice(0, bounds.openStart) + newOpening + result.slice(bounds.openEnd);
  }
  const newOpening = opening.replace(/>$/, `\n   ${namespace}:${tag}="${value}">`);
  return result.slice(0, bounds.openStart) + newOpening + result.slice(bounds.openEnd);
}

function mainDescriptionBounds(xmpText) {
  const opening = /<rdf:Description\b(?=[^>]*\brdf:about\s*=\s*(["'])\s*\1)[^>]*>/i.exec(xmpText);
  if (!opening) return null;
  const openStart = opening.index;
  const openEnd = openStart + opening[0].length;
  if (/\/\s*>$/.test(opening[0])) return { openStart, openEnd, selfClosing: true };

  const tagPattern = /<\/?rdf:Description\b[^>]*>/gi;
  tagPattern.lastIndex = openEnd;
  let depth = 1;
  let match;
  while ((match = tagPattern.exec(xmpText))) {
    if (/^<\/rdf:Description/i.test(match[0])) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return { openStart, openEnd, closeStart: match.index, selfClosing: false };
  }
  return null;
}

function updateMainOpening(xmpText, update) {
  const bounds = mainDescriptionBounds(xmpText);
  if (!bounds) return xmpText;
  const opening = xmpText.slice(bounds.openStart, bounds.openEnd);
  return xmpText.slice(0, bounds.openStart) + update(opening) + xmpText.slice(bounds.openEnd);
}

function ensureNamespace(xmpText, prefix, uri) {
  const bounds = mainDescriptionBounds(xmpText);
  if (!bounds) return xmpText;
  const opening = xmpText.slice(bounds.openStart, bounds.openEnd);
  if (new RegExp(`xmlns:${prefix}\\s*=`).test(opening)) return xmpText;
  return updateMainOpening(xmpText, (tag) => tag.replace(/\/?>(?=$)/, `\n   xmlns:${prefix}="${uri}"$&`));
}

// Elimina la forma de elemento hijo (<crs:Tag>valor</crs:Tag>) de un atributo crs.
// Si el preset trae un básico como elemento hijo y la IA lo escribe como atributo,
// ambas formas coexistirían y Lightroom podría leer la del elemento hijo (el valor
// viejo del preset) ignorando el atributo (el valor nuevo de la IA).
function stripCrsChildElement(xmpText, tag) {
  let result = xmpText.replace(new RegExp(`\\s*<crs:${tag}>[^<]*</crs:${tag}>`, "g"), "");
  return result.replace(new RegExp(`\\s*<crs:${tag}\\s*/>`, "g"), "");
}

export function patchXmpAttributes(xmpTemplateText, values) {
  let result = xmpTemplateText;
  for (const [tag, value] of Object.entries(values || {})) {
    // Temperature/Tint son Kelvin absoluto gestionado por writeWhiteBalance; nunca shifts.
    if (tag === "Temperature" || tag === "Tint") continue;
    result = stripCrsChildElement(result, tag);
    result = setAttribute(result, "crs", tag, formatValue(value));
  }
  return result;
}

// setXmpProperty — escribe una propiedad XMP simple (xmp:Rating, xmp:Label) como
// ATRIBUTO del rdf:Description principal. Este es el formato que Lightroom reconoce
// de forma fiable al importar el sidecar .xmp: xmp:Rating="5" y xmp:Label="Verde".
//
// Si la propiedad ya existe (como atributo o como elemento hijo), se elimina primero
// para evitar duplicidades y se reescribe como atributo único en el bloque principal.
function setXmpProperty(xmpText, tag, value) {
  // Elimina cualquier forma existente (atributo o elemento hijo) para evitar duplicados.
  let result = xmpText
    .replace(new RegExp(`\\s*xmp:${tag}\\s*=\\s*"[^"]*"`, "g"), "")
    .replace(new RegExp(`\\s*<xmp:${tag}>[^<]*</xmp:${tag}>`, "g"), "")
    .replace(new RegExp(`\\s*<xmp:${tag}\\s*/>`, "g"), "");
  // Escribe como ATRIBUTO en el rdf:Description principal (formato que Lightroom reconoce).
  return setAttribute(result, "xmp", tag, value);
}

// Marca la fotografía como seleccionada por RAW AI Studio: 5 estrellas + etiqueta verde,
// como metadatos XMP reales que Lightroom interpreta (xmp:Rating, xmp:Label) — nunca solo
// un estado interno de la app. Se añade siempre, exista o no ya el atributo en el preset.
// También fuerza crs:HasSettings="True": sin este atributo Lightroom trata el sidecar como
// si NO tuviera ningún ajuste de revelado y ignora todos los crs:* aunque estén presentes
// (el preset original, al ser un preset de Develop y no un sidecar de foto, normalmente no
// lo incluye) — esto es lo que hacía que el RAW se importara "sin ninguna modificación".
export function addRatingAndLabel(xmpText, { rating, label } = {}) {
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

// Rotación: escribe crs:Orientation en el XMP para que Lightroom rote la foto
// al sincronizar. AB = normal, BC = 90° CW, XYZ = 180°, AC = 270° CW.
export function addOrientation(xmpText, rotation) {
  if (rotation == null || rotation === 0) return xmpText;
  const orientation = rotation === 90 ? "BC" : rotation === 180 ? "XYZ" : rotation === 270 ? "AC" : "AB";
  return setAttribute(xmpText, "crs", "Orientation", orientation);
}

// Balance de blancos como Kelvin ABSOLUTO (no shift). Lightroom interpreta crs:Temperature
// como Kelvin cuando crs:WhiteBalance="Custom"; escribir un shift -100..100 ahí producía
// 2000 K absurdos. Aquí solo se escribe cuando hay corrección justificada (wb.write=true):
//   crs:WhiteBalance="Custom" + crs:Temperature="<kelvin>" + crs:Tint="<tint>".
// Si wb.write=false (sin As Shot fiable, confianza < 40% o dead-zone) → no-op: Lightroom
// conserva el WB nativo de la cámara (o el del preset si lo había).
export function writeWhiteBalance(xmpText, wb) {
  if (!wb || !wb.write || wb.finalKelvin == null) return xmpText;
  let result = xmpText;
  result = stripCrsChildElement(result, "Temperature");
  result = stripCrsChildElement(result, "Tint");
  result = setAttribute(result, "crs", "WhiteBalance", "Custom");
  result = setAttribute(result, "crs", "Temperature", String(wb.finalKelvin));
  result = setAttribute(result, "crs", "Tint", String(wb.finalTint ?? 0));
  return result;
}

// Comprobación REAL del contenido del archivo final — nunca dar por "OK" un XMP solo
// porque se haya generado en memoria. Relee el texto ya escrito y confirma que cada
// atributo que Lightroom necesita (xmp:Rating, xmp:Label y cada crs:<param> calculado por
// la IA) está realmente presente con el valor esperado.
export function validateXmp(xmpText, { rating, label, aiValues, treatment, selectedByAI } = {}) {
  const issues = [];
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
  // El Tratamiento (Color/Monocromo) debe quedar como instrucción real de Camera Raw, no
  // solo como etiqueta visual de la app — se relee el atributo tal como lo leerá Lightroom.
  if (treatment === "monochrome" && !/crs:ConvertToGrayscale\s*=\s*"True"/.test(xmpText)) issues.push("Tratamiento Monocromo solicitado pero crs:ConvertToGrayscale no está en 'True' en el XMP final");
  if (treatment === "color" && /crs:ConvertToGrayscale\s*=\s*"True"/.test(xmpText)) issues.push("Tratamiento Color solicitado pero el XMP final quedó marcado como monocromo (crs:ConvertToGrayscale=True)");
  return { valid: issues.length === 0, issues };
}