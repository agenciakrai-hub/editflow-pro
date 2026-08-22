// RAW AI Studio — compatibilidad del preset con la cámara real de cada foto.
// Un preset creado para una cámara (ej. Canon) no se aplica literalmente a otra marca
// (ej. Leica): los atributos dependientes de cámara/perfil se validan antes de escribirse.
// Los parámetros universales de revelado (exposición, contraste, luces...) nunca se tocan aquí.
// ROLLBACK: se parte SIEMPRE del XML real del preset cargado por el fotógrafo y solo se
// parchean atributos puntuales sobre él (nunca se reconstruye el XMP desde cero) — es la
// versión que demostró funcionar con Canon CR3 en Lightroom.

import { setAttribute } from "./xmpTagPatcher";

export const CAMERA_DEPENDENT_TAGS = [
  "CameraProfile", "ProfileName", "CameraProfileDigest", "LookName",
  "LookParametersName", "LookParametersUUID", "ConvertToGrayscale",
  "CameraCalibrationBluePrimaryHue", "CameraCalibrationBluePrimarySaturation",
  "CameraCalibrationGreenPrimaryHue", "CameraCalibrationGreenPrimarySaturation",
  "CameraCalibrationRedPrimaryHue", "CameraCalibrationRedPrimarySaturation",
  "CameraCalibrationShadowTint", "CameraCalibrationVersion",
  "LensProfileEnable", "LensProfileSetup", "LensProfileName", "LensProfileFilename", "LensProfileDigest"
];

// Solo los perfiles "Adobe *" (Adobe Color, Adobe Standard, Adobe Monochrome...) son
// universales — Adobe los genera de forma idéntica para cualquier cámara.
// IMPORTANTE (bug real corregido): los perfiles "Camera *" (Camera Standard, Camera
// Neutral, Camera Monochrome...) NO son genéricos aunque el nombre se repita entre marcas.
// Son perfiles "Camera Matching" que emulan el Picture Style/Picture Control de la
// cámara EXACTA que los generó, y casi nunca existen para otra marca aunque compartan
// nombre visible — tratarlos como intercambiables (como hacía el código anterior) es lo
// que causaba que un perfil aprendido de un Canon (p. ej. "Camera Monochrome") se
// escribiera literalmente en un DNG Leica: Lightroom no encuentra ese perfil para Leica
// y el revelado completo del sidecar queda sin aplicarse.
const GENERIC_PROFILE_PATTERNS = [/^adobe /i];

function getAttr(xmpText, tag) {
  const m = xmpText.match(new RegExp(`crs:${tag}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

const isGenericProfile = (profileName) => GENERIC_PROFILE_PATTERNS.some((re) => re.test(profileName));

// Marca de cámara con la que se capturó la foto de referencia del preset, leída de sus
// propios metadatos EXIF incrustados en el XMP (tiff:Make / exif:Make) — es la única forma
// fiable de saber a qué cámara pertenece un perfil "Camera *", ya que su nombre nunca la
// menciona explícitamente (p. ej. "Camera Standard" no dice "Canon").
export function getPresetSourceBrand(xmpText, brandFromMake) {
  const m = xmpText.match(/(?:tiff:Make|exif:Make)\s*=\s*"([^"]*)"/i);
  return m ? brandFromMake(m[1]) : null;
}

// ¿Puede usarse este perfil en esta cámara? Genérico (Adobe *) → sí siempre. Perfil
// "Camera *" → solo si la marca de la cámara que generó el preset coincide con la de la
// foto actual. Sin información suficiente de alguna de las dos → no se fuerza nada.
export function isProfileCompatible(profileName, sourceBrand, targetBrand) {
  if (!profileName) return true;
  if (isGenericProfile(profileName)) return true;
  if (!sourceBrand || !targetBrand || sourceBrand === "Desconocida" || targetBrand === "Desconocida") return true;
  return sourceBrand === targetBrand;
}

function stripAttributes(xmpText, tags) {
  let result = xmpText;
  for (const tag of tags) result = result.replace(new RegExp(`\\s*crs:${tag}\\s*=\\s*"[^"]*"`, "g"), "");
  return result;
}

// Adapta la plantilla de preset a la cámara real de la fotografía:
// - Si el perfil de cámara del preset es incompatible (ej. perfil Canon en un DNG Leica),
//   se retiran los atributos dependientes de cámara y Lightroom usa el perfil propio del RAW.
// - Si la cámara es monocroma de verdad (detectado en el RAW, nunca en la preview) y el
//   preset no declara un perfil monocromo, se retira igualmente para no forzar color.
export function sanitizePresetForCamera(xmpText, cameraInfo, brandFromMake) {
  const profileName = getAttr(xmpText, "CameraProfile") || getAttr(xmpText, "ProfileName");
  const brand = cameraInfo?.brand;
  const sourceBrand = getPresetSourceBrand(xmpText, brandFromMake);

  if (profileName && !isProfileCompatible(profileName, sourceBrand, brand)) {
    return {
      xmpText: stripAttributes(xmpText, CAMERA_DEPENDENT_TAGS),
      profileUsed: `Perfil propio del RAW (se omitió "${profileName}" de ${sourceBrand}, incompatible con ${brand})`,
      profileStripped: true
    };
  }

  if (cameraInfo?.isMonochrome === true && (!profileName || !/mono/i.test(profileName))) {
    return {
      xmpText: stripAttributes(xmpText, ["CameraProfile", "ProfileName", "ConvertToGrayscale"]),
      profileUsed: "Perfil monocromo original de la cámara (respetado, no sobrescrito)",
      profileStripped: true
    };
  }

  return { xmpText, profileUsed: profileName || "Perfil del preset", profileStripped: false };
}

const EXPLICIT_PROFILE_NAMES = {
  adobe_color: "Adobe Color",
  adobe_neutral: "Adobe Neutral",
  adobe_monochrome: "Adobe Monochrome"
};

// --- Aislamiento del preset (portado de Editkrfoto) ---
// Preset-template wrapper: atributos que hacen que Lightroom trate el .xmp como
// DEFINICIÓN de preset (no como ajustes aplicados) e ignore los básicos. Se eliminan
// siempre, en cualquier modo: no son ajustes de revelado, solo metadatos del preset.
const PRESET_WRAPPER_ATTRS = [
  "PresetType", "UUID", "Cluster", "PresetSubtype",
  "SupportsAmount", "SupportsAmount2", "SupportsColor", "SupportsMonochrome",
  "SupportsHighDynamicRange", "SupportsNormalDynamicRange",
  "SupportsSceneReferred", "SupportsOutputReferred",
  "RequiresRGBTables", "ShowInPresets", "ShowInQuickActions",
  "CameraModelRestriction",
  "Name", "ShortName", "SortName", "Group", "Description"
];

// Adobe Look UUIDs — Lightroom resuelve <crs:Look> por UUID, no por nombre. Un UUID
// ausente/incorrecto hace que Lightroom caiga a "Adobe Estándar".
const ADOBE_LOOK_UUIDS = {
  "Adobe Color": "B952C231111CD8E0ECCF14B86BAA7077",
  "Adobe Landscape": "6F9C877E84273F4E8271E6B91BEB36A1",
  "Adobe Vivid": "EA1DE074F188405965EF399C72C221D9",
  "Adobe Portrait": "D6496412E06A83789C499DF9540AA616",
  "Adobe Monochrome": "0CFE8F8AB563B2A73CE0B0077D20817"
};

function stripPresetWrapper(xmpText) {
  return stripAttributes(xmpText, PRESET_WRAPPER_ATTRS);
}

function stripLookBlock(xmpText) {
  return xmpText.replace(/\s*<crs:Look>[\s\S]*?<\/crs:Look>/g, "");
}

function applyAdobeLook(xmpText, profileName) {
  const uuid = ADOBE_LOOK_UUIDS[profileName];
  if (!uuid) return xmpText;
  const lookBlock = `\n   <crs:Look>\n    <crs:Name>${profileName}</crs:Name>\n    <crs:UUID>${uuid}</crs:UUID>\n    <crs:SupportsAmount>True</crs:SupportsAmount>\n   </crs:Look>`;
  if (/<\/rdf:Description>/.test(xmpText)) {
    return xmpText.replace(/(<\/rdf:Description>)/, `${lookBlock}\n  $1`);
  }
  return xmpText.replace(/(<rdf:Description[^>]*?)\/>/, `$1>${lookBlock}\n  </rdf:Description>`);
}

// Identifica una cámara para agrupar fotos del mismo modelo en el paso de perfil — nunca se
// usa para "adivinar" nombres de perfil, solo para mostrar/agrupar y para resolver qué
// elección de perfil (de varias, una por cámara) corresponde a cada foto.
export function cameraKeyFromInfo(cameraInfo) {
  const brand = cameraInfo?.brand && cameraInfo.brand !== "Desconocida" ? cameraInfo.brand : "";
  const model = cameraInfo?.model || "";
  const key = `${brand} ${model}`.trim();
  return key || "Desconocida";
}

// profileChoice puede venir en el formato antiguo (un único { mode, treatment } para todo
// el lote, antes de existir el agrupado por cámara) o en el nuevo formato por cámara
// ({ byCamera: { [cameraKey]: {mode,treatment} }, default }). Se resuelve siempre a un
// choice simple antes de aplicarlo, para no tener que tocar applyProfileChoice.
export function resolveProfileChoiceForCamera(profileChoice, cameraInfo) {
  if (!profileChoice) return { mode: "keep" };
  if (!profileChoice.byCamera) return profileChoice; // formato antiguo, sin cambios
  const key = cameraKeyFromInfo(cameraInfo);
  return profileChoice.byCamera[key] || profileChoice.default || { mode: "keep" };
}

// El Tratamiento (Color/Monocromo) es independiente del Perfil: se escribe siempre como
// crs:ConvertToGrayscale explícito en el XMP final, nunca como una simple etiqueta visual
// de la app. "auto"/sin tratamiento no fuerza nada (se respeta lo que decidiera el perfil).
function applyTreatment(xmpText, treatment) {
  if (treatment === "monochrome") return setAttribute(xmpText, "crs", "ConvertToGrayscale", "True");
  if (treatment === "color") return setAttribute(xmpText, "crs", "ConvertToGrayscale", "False");
  return xmpText;
}

// El fotógrafo decide explícitamente qué perfil/tratamiento debe usar Lightroom, en vez de
// que la app lo adivine. La app nunca "convierte" la foto: solo escribe el perfil elegido
// en el XMP (siempre sobre el XML real del preset) y deja que Camera Raw haga el revelado.
// - mode "keep" (DEFECTO): no se toca NINGÚN atributo de perfil — el XML del preset pasa
//   intacto tal cual el fotógrafo lo cargó. Esta es la única forma de garantizar que Canon
//   (y cualquier cámara) conserve exactamente el perfil que Lightroom ya sabe interpretar,
//   sin arriesgarse a un "Falta el perfil" por un CameraProfile/Digest que no cuadran.
// - mode "camera": no se fuerza ningún perfil — se retira el del preset y Lightroom usa el
//   nativo de cada RAW.
// - mode "adobe_color/neutral/monochrome": el fotógrafo pide EXPLÍCITAMENTE sustituir el
//   perfil por uno universal de Adobe, sustituyendo cualquier perfil de cámara que trajera
//   el preset (p. ej. uno de Canon en un DNG Leica).
export function applyProfileChoice(xmpText, cameraInfo, choice, brandFromMake) {
  // Mejora #2: siempre se convierte el preset-template en ajustes aplicados (se eliminan
  // PresetType/UUID/ShowInPresets…). No toca ningún ajuste de revelado — solo metadatos
  // del preset que, si quedan, hacen que Lightroom ignore los básicos.
  const wrapperStripped = stripPresetWrapper(xmpText);

  const base = (() => {
    if (!choice || choice.mode === "keep") {
      return { xmpText: wrapperStripped, profileUsed: "Perfil original del preset (sin modificar)", profileStripped: false };
    }

    // Compatibilidad con estados antiguos guardados como "auto".
    if (choice.mode === "auto" && !choice.overridePreset) {
      return sanitizePresetForCamera(wrapperStripped, cameraInfo, brandFromMake);
    }

    // Mejora #4: se retira el bloque <crs:Look> embebido del preset para que no compita
    // con el perfil seleccionado.
    const stripped = stripLookBlock(stripAttributes(wrapperStripped, CAMERA_DEPENDENT_TAGS));
    if (choice.mode === "camera") {
      return { xmpText: stripped, profileUsed: `Perfil nativo de la cámara (${cameraInfo?.brand || "detectada"})`, profileStripped: true };
    }

    const chosenProfile = EXPLICIT_PROFILE_NAMES[choice.mode];
    if (!chosenProfile) return { xmpText: wrapperStripped, profileUsed: "Perfil original del preset (sin modificar)", profileStripped: false };

    // Mejora #3: se escribe el <crs:Look> con el UUID correcto para que Lightroom resuelva
    // el perfil de Adobe por UUID (no por nombre, que caería a "Adobe Estándar").
    const withProfile = setAttribute(stripped, "crs", "CameraProfile", chosenProfile);
    return { xmpText: applyAdobeLook(withProfile, chosenProfile), profileUsed: chosenProfile, profileStripped: true };
  })();

  const treatment = choice?.treatment;
  if (!treatment || treatment === "auto") return base;
  const treatmentLabel = treatment === "monochrome" ? "Monocromo" : "Color";
  return { ...base, xmpText: applyTreatment(base.xmpText, treatment), profileUsed: `${base.profileUsed} — Tratamiento: ${treatmentLabel}` };
}