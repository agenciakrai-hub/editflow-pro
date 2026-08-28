// Sanitización del TRATAMIENTO Color/B&N de la plantilla XMP (preset .xmp o perfil de
// estilo). Extraída de AjustesIA a un módulo puro para poder validarla con pruebas sobre
// XMP real.
//
// Regla de separación de capas: el perfil/preset aporta el look creativo; el motor
// técnico (autoBasicsEngine / hybridAdaptEngine) aporta los 6 básicos y el WB. Esta
// función solo sanea el tratamiento (Color/Monocromo) y NUNCA permite que un valor
// creativo destructivo (crs:Saturation <= -95) fuerce B/N en modo Color. No toca
// CameraProfile/ProfileName ni ningún perfil de cámara, ni los 6 básicos de IA.
//
// Regla "campo destructivo = no escribir": en modo Color, un Saturation <= -95 se
// ELIMINA del XMP (no se reescribe a 0) para que Lightroom conserve su valor por
// defecto. Así no se introduce un ajuste destructivo ni se esconde el problema con un
// 0 arbitrario.
import { setAttribute } from "../rawaistudio/xmpTagPatcher.js";

function stripGrayscale(xmp) {
  let r = xmp.replace(/\s*crs:ConvertToGrayscale\s*=\s*"[^"]*"/g, "");
  r = r.replace(/\s*<crs:ConvertToGrayscale\s*>[^<]*<\/crs:ConvertToGrayscale>/g, "");
  r = r.replace(/\s*<crs:ConvertToGrayscale\s*\/>/g, "");
  return r;
}

function neutralizeBwTreatment(xmp) {
  return xmp
    .replace(/(crs:Treatment\s*=\s*")Black &amp; White(")/g, "$1Color$2")
    .replace(/(crs:Treatment\s*=\s*")Black & White(")/g, "$1Color$2");
}

// Color: un crs:Saturation <= -95 es B/N práctico. En modo Color se ELIMINA el atributo
// (atributo o elemento hijo) en lugar de reescribirlo a 0. Respeta la regla
// "campo destructivo = no escribir". Cubre atributo y elemento hijo. No toca nada más.
function neutralizeDesaturatingSaturation(xmp) {
  let r = xmp;
  const attrRe = /crs:Saturation\s*=\s*"(-?\d+(?:\.\d+)?)"/;
  const am = r.match(attrRe);
  if (am && parseFloat(am[1]) <= -95) {
    r = r.replace(/\s*crs:Saturation\s*=\s*"[^"]*"/, "");
  }
  const elemRe = /<crs:Saturation\s*>(-?\d+(?:\.\d+)?)<\/crs:Saturation>/;
  const em = r.match(elemRe);
  if (em && parseFloat(em[1]) <= -95) {
    r = r.replace(/\s*<crs:Saturation\s*>[^<]*<\/crs:Saturation>/, "");
  }
  return r;
}

function setGrayscaleFlag(xmp, value) {
  const re = /crs:ConvertToGrayscale\s*=\s*"[^"]*"/;
  if (re.test(xmp)) return xmp.replace(re, `crs:ConvertToGrayscale="${value}"`);
  const selfClosing = /<rdf:Description\b([^>]*?)\/>/;
  if (selfClosing.test(xmp)) return xmp.replace(selfClosing, `<rdf:Description$1\n   crs:ConvertToGrayscale="${value}"/>`);
  return xmp.replace(/(<rdf:Description[^>]*?)(>)/, `$1\n   crs:ConvertToGrayscale="${value}"$2`);
}

// treatment: "auto" | "color" | "monochrome"; cameraInfo: { isMonochrome } | null
export function sanitizeTreatment(xmp, treatment, cameraInfo) {
  const isMono = !!(cameraInfo && cameraInfo.isMonochrome);
  // Sensor realmente monocromo (Leica Monochrom…): respetar SIEMPRE el carácter
  // monocromo, sea cual sea el modo elegido. No se fuerza color sobre un sensor sin Bayer.
  if (isMono) return xmp;
  if (treatment === "monochrome") return setGrayscaleFlag(xmp, "True");
  if (treatment === "color") {
    // Color explícito: eliminar cualquier orden de escala de grises heredada del
    // preset/perfil, forzar crs:Treatment="Color" y eliminar Saturation que fuerce B/N
    // (<= -95). No toca CameraProfile, WB ni los 6 básicos de IA.
    let r = stripGrayscale(xmp);
    r = neutralizeBwTreatment(r);
    r = neutralizeDesaturatingSaturation(r);
    if (!/crs:Treatment\s*=/.test(r)) r = setAttribute(r, "crs", "Treatment", "Color");
    return r;
  }
  // auto + cámara de color: elimina el B/N impuesto por el preset.
  return neutralizeBwTreatment(stripGrayscale(xmp));
}