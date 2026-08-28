// Auditoría del pipeline PhotographerStyleProfile -> XMP (Casos A-F).
// Importa las funciones REALES (styleProfileToXmpTemplate, sanitizeTreatment,
// patchXmpAttributes, addRatingAndLabel) y verifica el XMP final que llega a Lightroom.
import { styleProfileToXmpTemplate } from "./styleProfileToXmpTemplate.js";
import { sanitizeTreatment } from "./treatmentSanitizer.js";
import { patchXmpAttributes, addRatingAndLabel } from "../rawaistudio/xmpTagPatcher.js";

const TECHNICAL_KEYS = ["Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012"];
function restrictToTechnicalBasics(values, hasTemplate) {
  if (!hasTemplate) return values;
  const out = {};
  for (const k of TECHNICAL_KEYS) if (typeof values[k] === "number") out[k] = values[k];
  return out;
}

// Pipeline CORRECTO (después del parche): plantilla -> básicos IA -> sanitize -> label.
function buildXmp({ template, aiValues, treatment, cameraInfo, hasTemplate }) {
  let xmp = template;
  xmp = patchXmpAttributes(xmp, restrictToTechnicalBasics(aiValues, hasTemplate));
  xmp = sanitizeTreatment(xmp, treatment, cameraInfo);
  xmp = addRatingAndLabel(xmp, { rating: 0, label: "Green" });
  return xmp;
}
// Pipeline BUGGY (antes del parche): sanitize ANTES de patch + sin restrict -> la IA
// sobreescribe los creativos del perfil (incluido Saturation=-100).
function buildXmpBuggy({ template, aiValues, treatment, cameraInfo }) {
  let xmp = template;
  xmp = sanitizeTreatment(xmp, treatment, cameraInfo);
  xmp = patchXmpAttributes(xmp, aiValues);
  xmp = addRatingAndLabel(xmp, { rating: 0, label: "Green" });
  return xmp;
}

const has = (x, re) => new RegExp(re).test(x);
const absent = (x, re) => !has(x, re);

export function runAudit() {
  const failures = [];
  const snaps = {};
  const check = (cond, msg) => { if (!cond) failures.push(msg); };

  // Caso A — Perfil normal: la IA aporta Saturation=-100 pero el perfil dice +5.
  const profileA = { creative_recipe: { Vibrance: 20, Saturation: 5, Clarity2012: 10, Texture2012: 5 } };
  const tplA = styleProfileToXmpTemplate(profileA);
  const iaA = { Exposure2012: 0.3, Contrast2012: 8, Highlights2012: -20, Shadows2012: 15, Saturation: -100, Vibrance: -100 };
  const beforeA = buildXmpBuggy({ template: tplA, aiValues: iaA, treatment: "color", cameraInfo: { isMonochrome: false } });
  const afterA = buildXmp({ template: tplA, aiValues: iaA, treatment: "color", cameraInfo: { isMonochrome: false }, hasTemplate: true });
  snaps.A_before = beforeA;
  snaps.A_after = afterA;
  check(has(afterA, 'crs:Vibrance="\\+20"'), "A: Vibrance del perfil sobrevive");
  check(has(afterA, 'crs:Saturation="\\+5"'), "A: Saturation del perfil (+5)");
  check(has(afterA, 'crs:Clarity2012="\\+10"'), "A: Clarity del perfil");
  check(has(afterA, 'crs:Texture2012="\\+5"'), "A: Texture del perfil");
  check(has(afterA, 'crs:Exposure2012="\\+0.30"'), "A: Exposure de la IA");
  check(absent(afterA, 'crs:Saturation="-100"'), "A: no Saturation -100 de la IA");
  check(has(afterA, '<xmp:Label>Green</xmp:Label>'), "A: etiqueta verde");
  check(has(beforeA, 'crs:Saturation="-100"'), "A(before): el flujo viejo sí escribía -100 (demuestra la causa)");

  // Caso B — Campo creativo ausente: sin Saturation en el perfil -> no se escribe.
  const profileB = { creative_recipe: { Vibrance: 20 } };
  const tplB = styleProfileToXmpTemplate(profileB);
  const afterB = buildXmp({ template: tplB, aiValues: { Exposure2012: 0.2 }, treatment: "color", cameraInfo: { isMonochrome: false }, hasTemplate: true });
  snaps.B = afterB;
  check(absent(afterB, "crs:Saturation"), "B: campo ausente no se escribe (ni 0 ni -100)");

  // Caso C — Perfil + IA básicos coexisten sin destruirse.
  check(has(afterA, "crs:Vibrance=") && has(afterA, "crs:Exposure2012="), "C: creativos + básicos coexisten");

  // Caso D — Tratamiento Color: ni -100 ni ConvertToGrayscale.
  const profileD = { creative_recipe: { Saturation: -100 } };
  const tplD = styleProfileToXmpTemplate(profileD);
  const afterD = buildXmp({ template: tplD, aiValues: {}, treatment: "color", cameraInfo: { isMonochrome: false }, hasTemplate: true });
  snaps.D = afterD;
  check(absent(afterD, 'crs:Saturation="-100"'), "D: no Saturation -100");
  check(absent(afterD, 'crs:ConvertToGrayscale="True"'), "D: no ConvertToGrayscale");

  // Caso F — Etiqueta verde de Lightroom.
  check(has(afterA, "<xmp:Label>Green</xmp:Label>"), "F: etiqueta verde presente");

  return { ok: failures.length === 0, failures, snaps };
}