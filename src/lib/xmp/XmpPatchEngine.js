// XmpPatchEngine — SceneRecipe.preset_data -> valores de etiquetas de revelado, y
// parcheo literal de un .xmp real de Lightroom. Parsea el XML SÓLO para localizar
// los nodos; modifica el texto original reemplazando la subcadena exacta del
// elemento, de modo que el archivo queda byte a byte idéntico salvo los valores.
// No usa XMLSerializer ni regex, no genera XMP nuevo. Independiente del Develop
// Engine y del agente local.

const TAG_BY_RECIPE_FIELD = {
  exposure: "Exposure2012",
  contrast: "Contrast2012",
  highlights: "Highlights2012",
  shadows: "Shadows2012",
  whites: "Whites2012",
  blacks: "Blacks2012",
  tint: "Tint",
  vibrance: "Vibrance",
  saturation: "Saturation",
  sharpening: "Sharpness",
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Lee (solo lectura) el valor textual actual de una etiqueta crs por localName.
export function readTagValue(xmpText, localName) {
  const doc = new DOMParser().parseFromString(xmpText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  for (const el of doc.getElementsByTagName("*")) {
    if (el.localName === localName) return el.textContent;
  }
  return null;
}

// Construye { TagName: valor } desde el recipe. Temperature se calcula como
// KelvinExistente + shift*50 (ventaja del parche: conserva el WB del fotógrafo).
// Si no hay Kelvin existente en el XMP, no se toca Temperature (no se inserta).
export function recipeToTagValues(recipe, existingTemperature) {
  const p = recipe?.preset_data || {};
  const out = {};
  for (const [field, tag] of Object.entries(TAG_BY_RECIPE_FIELD)) {
    const v = num(p[field]);
    if (v !== null) out[tag] = String(v);
  }
  const shift = num(p.temperature);
  const base = num(existingTemperature);
  if (shift !== null && base !== null) {
    const kelvin = Math.min(50000, Math.max(2000, Math.round(base + shift * 50)));
    out["Temperature"] = String(kelvin);
  }
  return out;
}

// Parchea las etiquetas dadas en el XMP reemplazando la subcadena exacta del
// elemento. tagValues: { TagName: valorString }. Solo modifica etiquetas que
// existan como <prefijo:Tag>old</prefijo:Tag>; las ausentes se dechan intactas.
const CRS_NS = "http://ns.adobe.com/camera-raw-settings/1.0/";

// Inserta las etiquetas de revelado que no existen en el XMP como elementos hijo
// <crs:Tag> dentro del rdf:Description que aloja los Camera Raw Settings:
//   - Si el bloque crs ya existe, inserta los <crs:Tag> antes de </rdf:Description>.
//     Si la descripción es self-closing (<rdf:Description .../>), la convierte en
//     abierta y le añade los hijos.
//   - Si no existe ningún bloque crs, crea un nuevo rdf:Description con xmlns:crs
//     dentro de rdf:RDF, con el formato que usa Lightroom.
// No toca el resto del XMP. Si la estructura no es la esperada, deja las etiquetas
// en `missing` para no romper el archivo.
function insertMissingDevelopTags(raw, tags, tagValues, patched, missing) {
  const prefix = "crs";
  const tagLines = tags.map((t) => `  <${prefix}:${t}>${tagValues[t]}</${prefix}:${t}>`).join("\n");

  if (raw.indexOf("xmlns:crs") !== -1) {
    const nsIdx = raw.indexOf("xmlns:crs");
    const descOpenIdx = raw.slice(0, nsIdx).lastIndexOf("<rdf:Description");
    if (descOpenIdx === -1) { missing.push(...tags); return raw; }
    const openTagEnd = raw.indexOf(">", descOpenIdx);
    if (openTagEnd === -1) { missing.push(...tags); return raw; }
    if (raw[openTagEnd - 1] === "/") {
      // Descripción self-closing: pasar a abierta e insertar los hijos.
      const slashPos = openTagEnd - 1;
      const opened = raw.slice(0, slashPos) + ">" + raw.slice(slashPos + 2);
      const insertAt = slashPos + 1;
      patched.push(...tags);
      return opened.slice(0, insertAt) + "\n" + tagLines + "\n  </rdf:Description>" + opened.slice(insertAt);
    }
    const closeIdx = raw.indexOf("</rdf:Description>", descOpenIdx);
    if (closeIdx === -1) { missing.push(...tags); return raw; }
    patched.push(...tags);
    return raw.slice(0, closeIdx) + tagLines + "\n  " + raw.slice(closeIdx);
  }

  const rdfCloseIdx = raw.indexOf("</rdf:RDF>");
  if (rdfCloseIdx === -1) { missing.push(...tags); return raw; }
  const block = `  <rdf:Description rdf:about="" xmlns:crs="${CRS_NS}">\n${tagLines}\n  </rdf:Description>\n`;
  patched.push(...tags);
  return raw.slice(0, rdfCloseIdx) + block + raw.slice(rdfCloseIdx);
}

// Parchea las etiquetas dadas en el XMP. Para etiquetas que existen como elemento,
// reemplaza la subcadena exacta del elemento (byte a byte salvo el valor). Para
// etiquetas que NO existen, las crea dentro del bloque Camera Raw Settings con el
// formato de Lightroom (ver insertMissingDevelopTags).
export function patchDevelopTags(xmpText, tagValues) {
  const doc = new DOMParser().parseFromString(xmpText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("El archivo no es un XML válido.");
  }
  let raw = xmpText;
  const patched = [];
  const missing = [];
  const toInsert = [];
  for (const [tag, value] of Object.entries(tagValues)) {
    let node = null;
    for (const el of doc.getElementsByTagName("*")) {
      if (el.localName === tag) { node = el; break; }
    }
    if (node) {
      const open = `<${node.nodeName}>`;
      const close = `</${node.nodeName}>`;
      const target = `${open}${node.textContent}${close}`;
      const replacement = `${open}${value}${close}`;
      if (raw.indexOf(target) === -1) { missing.push(tag); continue; }
      raw = raw.replace(target, replacement);
      patched.push(tag);
    } else {
      toInsert.push(tag);
    }
  }
  if (toInsert.length) {
    raw = insertMissingDevelopTags(raw, toInsert, tagValues, patched, missing);
  }
  return { text: raw, patched, missing };
}