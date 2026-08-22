// KR Auto Nivelado — motor de normalización de la base técnica de luz.
// Único objetivo: asentar una base técnica coherente sobre la que el fotógrafo
// aplica SUS presets. NO replica el Auto de Lightroom (no analiza píxeles): aplica
// reglas deterministas definidas sobre los parámetros base del XMP.
//
// Solo toca: Exposure2012, Highlights2012, Shadows2012, Whites2012, Blacks2012.
// Nunca: balance de blancos (Temperature/Tint), curvas (ToneCurve*), HSL,
// calibración (CameraProfile/Calibration*) ni máscaras.
//
// DOM-free (servidor) — el frontend usa su propio nivelador DOM
// (src/lib/xmp/krAutoLevel.js) que aplica ESTOS mismos valores. Si cambias la base,
// cambia KR_LEVEL_BASE en ambos sitios (son los mismos números).

export const KR_LEVEL_TAGS = [
  "Exposure2012",
  "Highlights2012",
  "Shadows2012",
  "Whites2012",
  "Blacks2012",
];

// Base técnica de luz nivelada: valores absolutos que se escriben en cada XMP.
export const KR_LEVEL_BASE = {
  Exposure2012: 0.1,
  Highlights2012: -15,
  Shadows2012: 15,
  Whites2012: 5,
  Blacks2012: -5,
};

const CRS_NS = "http://ns.adobe.com/camera-raw-settings/1.0/";

export function krLevelValues() {
  const out = {};
  for (const tag of KR_LEVEL_TAGS) {
    out[tag] = String(Math.round(KR_LEVEL_BASE[tag] * 100) / 100);
  }
  return out;
}

// Lee un valor de etiqueta como elemento <prefix:Tag>val</prefix:Tag> (cualquier prefijo).
function readTag(xmp, tag) {
  const m = xmp.match(new RegExp(`<([A-Za-z_][\\w.-]*):${tag}>([^<]*)</\\1:${tag}>`));
  return m ? m[2] : null;
}

function replaceTag(xmp, tag, value) {
  return xmp.replace(
    new RegExp(`(<([A-Za-z_][\\w.-]*):${tag}>)[^<]*(</\\2:${tag}>)`),
    `$1${value}$3`
  );
}

// Inserta una etiqueta crs que no existe, dentro del bloque Camera Raw Settings,
// con el formato que usa Lightroom (mismo criterio que XmpPatchEngine del frontend).
function insertTag(xmp, tag, value) {
  const el = `<crs:${tag}>${value}</crs:${tag}>`;
  if (xmp.indexOf("xmlns:crs") !== -1) {
    const nsIdx = xmp.indexOf("xmlns:crs");
    const open = xmp.slice(0, nsIdx).lastIndexOf("<rdf:Description");
    if (open === -1) return xmp;
    const openEnd = xmp.indexOf(">", open);
    if (openEnd === -1) return xmp;
    if (xmp[openEnd - 1] === "/") {
      const slash = openEnd - 1;
      const opened = xmp.slice(0, slash) + ">" + xmp.slice(slash + 2);
      const at = slash + 1;
      return opened.slice(0, at) + "\n  " + el + "\n  </rdf:Description>" + opened.slice(at);
    }
    const close = xmp.indexOf("</rdf:Description>", open);
    if (close === -1) return xmp;
    return xmp.slice(0, close) + "  " + el + "\n  " + xmp.slice(close);
  }
  const rdfClose = xmp.indexOf("</rdf:RDF>");
  if (rdfClose === -1) return xmp;
  const block = `  <rdf:Description rdf:about="" xmlns:crs="${CRS_NS}">\n  ${el}\n  </rdf:Description>\n`;
  return xmp.slice(0, rdfClose) + block + xmp.slice(rdfClose);
}

export function levelXmpText(xmp) {
  const values = krLevelValues();
  let out = xmp;
  for (const tag of KR_LEVEL_TAGS) {
    out = readTag(out, tag) !== null
      ? replaceTag(out, tag, values[tag])
      : insertTag(out, tag, values[tag]);
  }
  return out;
}

export function levelXmpBatch(files) {
  return files.map((f) => ({ name: String(f.name), xmp: levelXmpText(String(f.xmp)) }));
}