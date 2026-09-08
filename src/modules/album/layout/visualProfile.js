// Fase 2 — PERFIL VISUAL NORMALIZADO de una foto para la maquetación automática.
// Salida ligera del análisis IA visual. El planificador determinista (Fase 1) la
// consume como PESOS adicionales dentro de su scoring existente — NUNCA la
// sustituye. Todos los campos son opcionales: el planificador funciona sin perfil
// (Fase 1 pura) y con perfil parcial. Ningún campo ausente bloquea la maquetación.
import { orientationOf } from "@/modules/album/layout/layoutEngine";

const SIZES = ["small", "medium", "large"];
const ORIENTS = new Set(["landscape", "portrait", "square"]);
export const sizeRank = { small: 0, medium: 1, large: 2 };

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const clampUnit = (v) => clamp(v, 0, 1);
const clampScore = (v) => clamp(v, 0, 100);
const clampInt = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);

// Clase de tamaño preferida para una foto a partir de su importancia visual (0-100).
// >66 = contenedor grande, 33-66 = mediano, <33 = pequeño.
export function sizeClassOf(visualImportance) {
  const v = clampScore(visualImportance);
  if (v >= 66) return "large";
  if (v >= 33) return "medium";
  return "small";
}

// Clasifica el tamaño RELATIVO de un hueco dentro de su plantilla (área del hueco
// frente al hueco mayor del grupo). El planificador lo usa para emparejar la
// preferencia de tamaño de la foto con el hueco que le corresponde.
export function slotSizeClass(slot, maxArea) {
  const a = (slot?.w_mm || 0) * (slot?.h_mm || 0);
  if (!(a > 0) || !(maxArea > 0)) return "medium";
  const r = a / maxArea;
  if (r >= 0.66) return "large";
  if (r < 0.34) return "small";
  return "medium";
}

// Riesgo (0-1) de que un recorte COVER corte caras: combina el estrés de recorte
// (distancia logarítmica ratio_hueco/ratio_foto, la misma métrica del determinista)
// con el tamaño del hueco (un hueco pequeño agrava el riesgo). 0 si no hay caras.
export function faceCropRisk(profile, slotRatio, photoRatio, slotSize) {
  if (!profile || !(profile.facesCount > 0) || !(slotRatio > 0) || !(photoRatio > 0)) return 0;
  const stress = Math.abs(Math.log(slotRatio / photoRatio));
  const sizeMul = slotSize === "small" ? 1.4 : slotSize === "medium" ? 1.0 : 0.7;
  return Math.min(1, stress * 1.5) * sizeMul;
}

// Normaliza la salida cruda de la IA a un perfil estable y validado. NUNCA lanza:
// campos ausentes/inválidos → valores por defecto neutros (la Fase 1 sigue válida).
export function normalizeProfile(raw, photo) {
  const r = raw && typeof raw === "object" ? raw : {};
  const vi = clampScore(r.visualImportance ?? 50);
  const faces = clampInt(r.facesCount, 0, 50);
  const people = clampInt(r.peopleCount, 0, 50);
  const fp = r.focalPoint && typeof r.focalPoint === "object" ? r.focalPoint : {};
  const comp = r.composition && typeof r.composition === "object" ? r.composition : {};
  const pref = r.preferredSlot && typeof r.preferredSlot === "object" ? r.preferredSlot : {};
  const subject = typeof r.subjectType === "string" && r.subjectType.trim() ? r.subjectType.trim().toLowerCase() : "other";
  const prefSize = SIZES.includes(pref.size) ? pref.size : sizeClassOf(vi);
  const ratio = photo?.width_px > 0 && photo?.height_px > 0 ? photo.width_px / photo.height_px : null;
  const prefOrient = ORIENTS.has(pref.orientation) ? pref.orientation : ratio ? orientationOf(ratio) : null;
  return {
    photoId: photo?.id || null,
    subjectType: subject,
    visualImportance: vi,
    facesCount: faces,
    peopleCount: people,
    focalPoint: { x: clampUnit(fp.x ?? 0.5), y: clampUnit(fp.y ?? 0.5) },
    composition: {
      negativeSpace: clampUnit(comp.negativeSpace ?? 0.5),
      balance: clampUnit(comp.balance ?? 0.5),
      complexity: clampUnit(comp.complexity ?? 0.5),
    },
    preferredSlot: { size: prefSize, orientation: prefOrient },
  };
}