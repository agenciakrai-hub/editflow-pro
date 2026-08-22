// RAW AI Studio (cloud) — misma lógica de compatibilidad de perfil/cámara que
// src/lib/rawaistudio/presetProfile.js, portada al backend. Ver ese archivo para el
// razonamiento completo (perfiles "Camera *" no son intercambiables entre marcas, etc.).
import { setAttribute } from "./xmpTagPatcher.ts";

export const CAMERA_DEPENDENT_TAGS = [
  "CameraProfile", "ProfileName", "CameraProfileDigest", "LookName",
  "LookParametersName", "LookParametersUUID", "ConvertToGrayscale",
  "CameraCalibrationBluePrimaryHue", "CameraCalibrationBluePrimarySaturation",
  "CameraCalibrationGreenPrimaryHue", "CameraCalibrationGreenPrimarySaturation",
  "CameraCalibrationRedPrimaryHue", "CameraCalibrationRedPrimarySaturation",
  "CameraCalibrationShadowTint", "CameraCalibrationVersion",
  "LensProfileEnable", "LensProfileSetup", "LensProfileName", "LensProfileFilename", "LensProfileDigest"
];

const GENERIC_PROFILE_PATTERNS = [/^adobe /i];

function getAttr(xmpText: string, tag: string) {
  const m = xmpText.match(new RegExp(`crs:${tag}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

const isGenericProfile = (profileName: string) => GENERIC_PROFILE_PATTERNS.some((re) => re.test(profileName));

export function getPresetSourceBrand(xmpText: string, brandFromMake: (make: string) => string) {
  const m = xmpText.match(/(?:tiff:Make|exif:Make)\s*=\s*"([^"]*)"/i);
  return m ? brandFromMake(m[1]) : null;
}

export function isProfileCompatible(profileName: string, sourceBrand: string | null, targetBrand: string | undefined) {
  if (!profileName) return true;
  if (isGenericProfile(profileName)) return true;
  if (!sourceBrand || !targetBrand || sourceBrand === "Desconocida" || targetBrand === "Desconocida") return true;
  return sourceBrand === targetBrand;
}

function stripAttributes(xmpText: string, tags: string[]) {
  let result = xmpText;
  for (const tag of tags) result = result.replace(new RegExp(`\\s*crs:${tag}\\s*=\\s*"[^"]*"`, "g"), "");
  return result;
}

export function sanitizePresetForCamera(xmpText: string, cameraInfo: any, brandFromMake: (make: string) => string) {
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

const EXPLICIT_PROFILE_NAMES: Record<string, string> = {
  adobe_color: "Adobe Color",
  adobe_neutral: "Adobe Neutral",
  adobe_monochrome: "Adobe Monochrome"
};

// --- Aislamiento del preset (portado de Editkrfoto) ---
const PRESET_WRAPPER_ATTRS = [
  "PresetType", "UUID", "Cluster", "PresetSubtype",
  "SupportsAmount", "SupportsAmount2", "SupportsColor", "SupportsMonochrome",
  "SupportsHighDynamicRange", "SupportsNormalDynamicRange",
  "SupportsSceneReferred", "SupportsOutputReferred",
  "RequiresRGBTables", "ShowInPresets", "ShowInQuickActions",
  "CameraModelRestriction",
  "Name", "ShortName", "SortName", "Group", "Description"
];

const ADOBE_LOOK_UUIDS: Record<string, string> = {
  "Adobe Color": "B952C231111CD8E0ECCF14B86BAA7077",
  "Adobe Landscape": "6F9C877E84273F4E8271E6B91BEB36A1",
  "Adobe Vivid": "EA1DE074F188405965EF399C72C221D9",
  "Adobe Portrait": "D6496412E06A83789C499DF9540AA616",
  "Adobe Monochrome": "0CFE8F8AB563B2A73CE0B0077D20817"
};

function stripPresetWrapper(xmpText: string): string {
  return stripAttributes(xmpText, PRESET_WRAPPER_ATTRS);
}

function stripLookBlock(xmpText: string): string {
  return xmpText.replace(/\s*<crs:Look>[\s\S]*?<\/crs:Look>/g, "");
}

function applyAdobeLook(xmpText: string, profileName: string): string {
  const uuid = ADOBE_LOOK_UUIDS[profileName];
  if (!uuid) return xmpText;
  const lookBlock = `\n   <crs:Look>\n    <crs:Name>${profileName}</crs:Name>\n    <crs:UUID>${uuid}</crs:UUID>\n    <crs:SupportsAmount>True</crs:SupportsAmount>\n   </crs:Look>`;
  if (/<\/rdf:Description>/.test(xmpText)) {
    return xmpText.replace(/(<\/rdf:Description>)/, `${lookBlock}\n  $1`);
  }
  return xmpText.replace(/(<rdf:Description[^>]*?)\/>/, `$1>${lookBlock}\n  </rdf:Description>`);
}

export function cameraKeyFromInfo(cameraInfo: any) {
  const brand = cameraInfo?.brand && cameraInfo.brand !== "Desconocida" ? cameraInfo.brand : "";
  const model = cameraInfo?.model || "";
  const key = `${brand} ${model}`.trim();
  return key || "Desconocida";
}

export function resolveProfileChoiceForCamera(profileChoice: any, cameraInfo: any) {
  if (!profileChoice) return { mode: "keep" };
  if (!profileChoice.byCamera) return profileChoice;
  const key = cameraKeyFromInfo(cameraInfo);
  return profileChoice.byCamera[key] || profileChoice.default || { mode: "keep" };
}

function applyTreatment(xmpText: string, treatment: string) {
  if (treatment === "monochrome") return setAttribute(xmpText, "crs", "ConvertToGrayscale", "True");
  if (treatment === "color") return setAttribute(xmpText, "crs", "ConvertToGrayscale", "False");
  return xmpText;
}

export function applyProfileChoice(xmpText: string, cameraInfo: any, choice: any, brandFromMake: (make: string) => string) {
  // Mejora #2: siempre se convierte el preset-template en ajustes aplicados (se eliminan
  // PresetType/UUID/ShowInPresets…). No toca ningún ajuste de revelado — solo metadatos
  // del preset que, si quedan, hacen que Lightroom ignore los básicos.
  const wrapperStripped = stripPresetWrapper(xmpText);

  const base = (() => {
    if (!choice || choice.mode === "keep") {
      return { xmpText: wrapperStripped, profileUsed: "Perfil original del preset (sin modificar)", profileStripped: false };
    }

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