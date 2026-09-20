// MAQUETAR DESDE JPG — Mapeo entre metadatos XMP, clasificación de Selección IA
// y roles del planificador de maquetación.
//
// ESTADOS DE CLASIFICACIÓN (compatibles con Lightroom):
//   TOP         → xmp:Rating="5" + xmp:Label="Verde"  → rol "hero" (protagonista)
//   VALID       → xmp:Rating="4" + xmp:Label="Verde"  → rol "support" (apoyo)
//   REVIEW      → xmp:Label="Amarillo" (sin 5★)       → no entra en maquetación
//   UNCLASSIFIED→ sin XMP / sin rating+label           → no entra (salvo análisis)
//
// Los roles (hero/support) alimentan al planificador existente (autoPlanner)
// a través de roleOf: Map<photoId, role>. La baseline del planificador NO se
// modifica: este módulo solo proporciona mejores datos de entrada.

export const CLASSIFICATION = { TOP: "TOP", VALID: "VALID", REVIEW: "REVIEW", UNCLASSIFIED: "UNCLASSIFIED" };

// XMP → clasificación. Tolerante con mayúsculas/minúsculas del label (Lightroom
// escribe "Verde" pero algunos flujos pueden variar).
export function classifyFromXmp(rating, label) {
  const r = Number(rating) || 0;
  const l = (label || "").trim().toLowerCase();
  if (r === 5 && l === "verde") return CLASSIFICATION.TOP;
  if (r === 4 && l === "verde") return CLASSIFICATION.VALID;
  if (l === "amarillo") return CLASSIFICATION.REVIEW;
  return CLASSIFICATION.UNCLASSIFIED;
}

// Clasificación → rol del planificador (hero/support/null).
// TOP = protagonista (hero); VALID = apoyo (support); REVIEW/UNCLASSIFIED = null.
export function roleForClassification(classification) {
  if (classification === CLASSIFICATION.TOP) return "hero";
  if (classification === CLASSIFICATION.VALID) return "support";
  return null;
}

// Clasificación → XMP (para escribir sidecars desde Selección IA).
export function xmpForClassification(classification) {
  if (classification === CLASSIFICATION.TOP) return { rating: 5, label: "Verde" };
  if (classification === CLASSIFICATION.VALID) return { rating: 4, label: "Verde" };
  if (classification === CLASSIFICATION.REVIEW) return { rating: 0, label: "Amarillo" };
  return null;
}

// Rol de Selección IA (hero/key/support/detail) → clasificación para XMP.
// hero/key → TOP; support → VALID; detail → VALID; descartadas → REVIEW.
export function classificationForRole(role, aiState) {
  if (aiState === "discarded") return CLASSIFICATION.REVIEW;
  if (role === "hero" || role === "key") return CLASSIFICATION.TOP;
  if (role === "support" || role === "detail") return CLASSIFICATION.VALID;
  return null;
}

// ¿Esta clasificación entra en la maquetación? (TOP + VALID)
export function isMaquetable(classification) {
  return classification === CLASSIFICATION.TOP || classification === CLASSIFICATION.VALID;
}

// Base name sin extensión para matching JPG ↔ foto del proyecto.
// "IMG_0001.jpg" → "IMG_0001", "IMG_0001.CR2" → "IMG_0001"
export function baseName(filename) {
  return (filename || "").replace(/\.[^.]+$/, "").toUpperCase();
}