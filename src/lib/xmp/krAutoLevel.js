import { patchDevelopTags } from "@/lib/xmp/XmpPatchEngine";

// KR Auto Nivelado — nivelador de la base técnica de luz (frontend, basado en DOM).
// Aplica los MISMOS valores que base44/shared/krAutoLevelRules.ts (servidor/API REST).
// Si cambias la base, cambia KR_LEVEL_BASE en ambos sitios (son los mismos números).
//
// Solo: Exposure2012, Highlights2012, Shadows2012, Whites2012, Blacks2012.
// Reusa patchDevelopTags, que ya modifica valores existentes y crea las etiquetas
// que falten dentro del bloque Camera Raw Settings con el formato de Lightroom.

const KR_LEVEL_BASE = {
  Exposure2012: 0.1,
  Highlights2012: -15,
  Shadows2012: 15,
  Whites2012: 5,
  Blacks2012: -5,
};

export function krLevelTagValues() {
  const out = {};
  for (const [tag, v] of Object.entries(KR_LEVEL_BASE)) {
    out[tag] = String(Math.round(v * 100) / 100);
  }
  return out;
}

export function levelXmp(xmpText) {
  return patchDevelopTags(xmpText, krLevelTagValues()).text;
}