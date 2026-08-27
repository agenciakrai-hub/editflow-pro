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
  const attrRegex = new RegExp(`(${namespace}:${tag}\\s*=\\s*")([^"]*)(")`);
  if (attrRegex.test(xmpText)) return xmpText.replace(attrRegex, `$1${value}$3`);

  const selfClosing = /<rdf:Description\b([^>]*?)\/>/;
  if (selfClosing.test(xmpText)) {
    return xmpText.replace(selfClosing, `<rdf:Description$1\n   ${namespace}:${tag}="${value}"/>`);
  }
  return xmpText.replace(/(<rdf:Description[^>]*?)(>)/, `$1\n   ${namespace}:${tag}="${value}"$2`);
}

function ensureNamespace(xmpText, prefix, uri) {
  if (new RegExp(`xmlns:${prefix}\\s*=`).test(xmpText)) return xmpText;
  const selfClosing = /<rdf:Description\b([^>]*?)\/>/;
  if (selfClosing.test(xmpText)) {
    return xmpText.replace(selfClosing, `<rdf:Description$1\n   xmlns:${prefix}="${uri}"/>`);
  }
  return xmpText.replace(/(<rdf:Description[^>]*?)(>)/, `$1\n   xmlns:${prefix}="${uri}"$2`);
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

// Marca la fotografía como seleccionada por RAW AI Studio: 5 estrellas + etiqueta verde,
// como metadatos XMP reales que Lightroom interpreta (xmp:Rating, xmp:Label) — nunca solo
// un estado interno de la app. Se añade siempre, exista o no ya el atributo en el preset.
// También fuerza crs:HasSettings="True": sin este atributo Lightroom trata el sidecar como
// si NO tuviera ningún ajuste de revelado y ignora todos los crs:* aunque estén presentes
// (el preset original, al ser un preset de Develop y no un sidecar de foto, normalmente no
// lo incluye) — esto es lo que hacía que el RAW se importara "sin ninguna modificación".
// setXmpProperty — escribe una propiedad XMP simple (xmp:Rating, xmp:Label) SIEMPRE
// como ELEMENTO HIJO del primer rdf:Description. Esta es la forma CANÓNICA que el
// propio Lightroom escribe en sus sidecars .xmp y la que lee de forma fiable al
// "Leer metadatos del archivo". Escribirlos como atributo (xmp:Rating="5") es XMP
// válido, pero Lightroom a veces no los aplica al importar el sidecar — por eso se
// fuerza el elemento hijo: <xmp:Rating>5</xmp:Rating> y <xmp:Label>Green</xmp:Label>.
//
// Si la propiedad ya existe (como elemento hijo o como atributo), se normaliza a
// elemento hijo con el valor nuevo. Si el rdf:Description es autocerrado, se
// convierte en apertura+cierre para poder colgar el elemento hijo dentro.
function setXmpProperty(xmpText, tag, value) {
  // 1. Elemento hijo con contenido: <xmp:Tag>old</xmp:Tag> → reemplazar texto.
  const elemRegex = new RegExp(`(<xmp:${tag}>)([^<]*)(</xmp:${tag}>)`);
  if (elemRegex.test(xmpText)) return xmpText.replace(elemRegex, `$1${value}$3`);
  // 2. Elemento hijo autocerrado: <xmp:Tag/> → convertir en elemento con contenido.
  const selfCloseRegex = new RegExp(`<xmp:${tag}\\s*/>`);
  if (selfCloseRegex.test(xmpText)) return xmpText.replace(selfCloseRegex, `<xmp:${tag}>${value}</xmp:${tag}>`);
  // 3. Atributo: xmp:Tag="old" → eliminarlo; se reescribe como elemento hijo abajo.
  let result = xmpText;
  const attrRegex = new RegExp(`\\s*xmp:${tag}\\s*=\\s*"[^"]*"`);
  if (attrRegex.test(result)) result = result.replace(attrRegex, "");
  // 4. Insertar como elemento hijo en el primer rdf:Description.
  const selfClosingDesc = /<rdf:Description\b([^>]*?)\/>/;
  if (selfClosingDesc.test(result)) {
    return result.replace(selfClosingDesc, `<rdf:Description$1>\n      <xmp:${tag}>${value}</xmp:${tag}>\n    </rdf:Description>`);
  }
  const closeRegex = /(<\/rdf:Description>)/;
  if (closeRegex.test(result)) {
    return result.replace(closeRegex, `      <xmp:${tag}>${value}</xmp:${tag}>\n    $1`);
  }
  // Fallback final (XMP sin rdf:Description cerrado): atributo.
  return setAttribute(result, "xmp", tag, value);
}

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
  // Validación explícita del color verde: si la IA seleccionó esta foto, el XMP
  // final DEBE contener xmp:Label="Green" exactamente. Si no lo contiene, se
  // registra un issue — el usuario tiene que poder confiar en que el color verde
  // está realmente en el archivo, tanto en el flujo automático como en el manual.
  // Validación del color verde y rating: comprueba AMBAS formas (atributo y elemento
  // hijo) porque Lightroom puede escribir xmp:Label y xmp:Rating de cualquiera de
  // las dos maneras en sus sidecars .xmp.
  const hasGreenLabel = /xmp:Label\s*=\s*"Green"/.test(xmpText) || /<xmp:Label>Green<\/xmp:Label>/.test(xmpText);
  if (selectedByAI && !hasGreenLabel) issues.push('xmp:Label="Green" no está presente en el XMP final — la foto fue seleccionada por la IA pero el color verde no se escribió');
  const hasRating = rating != null && rating > 0 && (new RegExp(`xmp:Rating\\s*=\\s*"${rating}"`).test(xmpText) || new RegExp(`<xmp:Rating>${rating}</xmp:Rating>`).test(xmpText));
  if (rating != null && rating > 0 && !hasRating) issues.push("xmp:Rating no está presente en el XMP final");
  if (label) {
    const hasLabel = new RegExp(`xmp:Label\\s*=\\s*"${label}"`).test(xmpText) || new RegExp(`<xmp:Label>${label}</xmp:Label>`).test(xmpText);
    if (!hasLabel) issues.push("xmp:Label no está presente en el XMP final");
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