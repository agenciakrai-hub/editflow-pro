// Rellenar contenedor (POR LIENZO) — encuadre COVER inteligente con prioridad de
// caras. REUTILIZA el sistema existente: el resultado se expresa SIEMPRE como
// fit_mode "fill" + transformación virtual (escala y offsets en mm), el MISMO
// contrato que ya usan el editor (SlotFrame) y el renderizador de exportación
// (spreadRenderer). No existe motor paralelo de crop.
//
// Prioridades del ajuste:
//   1) Caras detectadas dentro del área visible (nunca cortadas, si es geométricamente posible).
//   2) Posición visual adecuada: el centro del grupo de caras queda en el ~42% del alto
//      del hueco (regla clásica de retrato: aire por encima de la cabeza).
//   3) Rellenar completamente el contenedor (sin huecos; cover nunca deforma).
//   4) Proporción original de la foto.
//
// Detección de caras (auditoría: EditFlow NO dispone de detección facial propia).
// Se usa la API NATIVA del navegador (window.FaceDetector, Shape Detection API)
// cuando está disponible, sobre la PREVIEW local de la foto (jamás el original, que
// no sale del dispositivo), con caché en memoria por foto. Si el navegador no la
// ofrece, o no detecta nada, se aplica un anclaje determinista hacia el tercio
// superior (donde suelen estar las cabezas). Nada se envía a ningún servicio.
import { freshTransform, photoRatio } from "@/modules/album/layout/layoutEngine";
import { getTierPreview } from "@/modules/album/lib/previewStore";

const faceCache = new Map(); // photoId -> [{x,y,w,h}] (normalizado 0..1) | null
const MAX_ZOOM = 3; // techo de zoom del relleno automático

let detectorChecked = false;
let detector = null;

function getDetector() {
  if (!detectorChecked) {
    detectorChecked = true;
    if (typeof window !== "undefined" && "FaceDetector" in window) {
      try { detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 8 }); } catch { detector = null; }
    }
  }
  return detector;
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
  img.src = url;
});

// Detecta (y cachea) las caras de una foto sobre su preview local. Devuelve null si
// el navegador no tiene detector, la foto no tiene preview o la detección falla.
export async function ensureFaces(projectId, photo) {
  if (!photo?.id) return null;
  if (faceCache.has(photo.id)) return faceCache.get(photo.id) ?? null;
  const det = getDetector();
  let faces = null;
  if (det) {
    try {
      let url = await getTierPreview(projectId, photo.id, "preview");
      if (!url) url = await getTierPreview(projectId, photo.id, "thumb");
      if (url) {
        const img = await loadImage(url);
        const found = await det.detect(img);
        if (found?.length) {
          const iw = img.naturalWidth || 1;
          const ih = img.naturalHeight || 1;
          faces = found.map((f) => ({
            x: f.boundingBox.x / iw,
            y: f.boundingBox.y / ih,
            w: f.boundingBox.width / iw,
            h: f.boundingBox.height / ih,
          }));
        }
      }
    } catch { faces = null; }
  }
  faceCache.set(photo.id, faces);
  return faces;
}

// Punto de atención: centro de la unión de las caras detectadas; sin caras, anclaje
// determinista (tercio alto si sobra imagen en vertical, centrado en horizontal).
function focusPoint(faces, dw, dh, w, h) {
  if (faces?.length) {
    const x0 = Math.min(...faces.map((f) => f.x));
    const y0 = Math.min(...faces.map((f) => f.y));
    const x1 = Math.max(...faces.map((f) => f.x + f.w));
    const y1 = Math.max(...faces.map((f) => f.y + f.h));
    return { uf: (x0 + x1) / 2, vf: (y0 + y1) / 2 };
  }
  return { uf: 0.5, vf: dh > h ? 0.38 : 0.5 };
}

// Transformación virtual que cubre el hueco por completo (cover, sin deformación)
// llevando el punto de atención al 42% del alto del hueco. La matemática es la misma
// que aplican SlotFrame (object-fit cover + translate/scale, origen centro) y
// drawPhoto en spreadRenderer → editor y exportación coinciden exactamente.
export function smartFillTransform(photo, slot, faces) {
  const identity = { fit_mode: "fill", transform: freshTransform() };
  if (!photo || !slot || !(slot.w_mm > 0) || !(slot.h_mm > 0)) return identity;
  const r = photoRatio(photo);
  const w = slot.w_mm;
  const h = slot.h_mm;
  // Dimensiones de la foto a escala COVER, en mm (cover: sobra exactamente una dimensión).
  const dw = r >= w / h ? h * r : w;
  const dh = r >= w / h ? h : w / r;
  const { uf, vf } = focusPoint(faces, dw, dh, w, h);
  const bx = 0; // punto de atención centrado en horizontal
  const by = -h * 0.08; // y algo por encima del centro (42% del alto)
  // Zoom mínimo k que mantiene la imagen cubriendo el hueco mientras el punto de
  // atención llega a su destino (prioridad 3: nunca dejar huecos).
  let k = 1;
  if (uf > 0) k = Math.max(k, (w / 2 + bx) / (dw * uf));
  if (uf < 1) k = Math.max(k, (w / 2 - bx) / (dw * (1 - uf)));
  if (vf > 0) k = Math.max(k, (h / 2 + by) / (dh * vf));
  if (vf < 1) k = Math.max(k, (h / 2 - by) / (dh * (1 - vf)));
  k = Math.min(MAX_ZOOM, k);
  // El k GUARDADO (redondeado) es el que fija los márgenes de cobertura: los offsets
  // se calculan y recortan con ese mismo k, o el redondeo dejaría franjas sin cubrir.
  k = Math.round(k * 100) / 100;
  let ox = bx - k * (uf - 0.5) * dw;
  let oy = by - k * (vf - 0.5) * dh;
  // Offsets recortados al margen real que deja el zoom: cubrir SIEMPRE el contenedor.
  ox = Math.max(-(k * dw - w) / 2, Math.min((k * dw - w) / 2, ox));
  oy = Math.max(-(k * dh - h) / 2, Math.min((k * dh - h) / 2, oy));
  return {
    fit_mode: "fill",
    transform: {
      scale: k,
      offset_x_mm: Math.round(ox * 100) / 100,
      offset_y_mm: Math.round(oy * 100) / 100,
      rotation: 0,
      crop: null,
    },
  };
}

// Rellena UN hueco de forma SÍNCRONA usando las caras ya cacheadas (sin detección
// asíncrona). Para gestiones interactivas (redimensionar contenedor, intercambiar).
export function smartFillSlot(slot, photo) {
  if (!slot || !photo) return { fit_mode: "fit", transform: freshTransform() };
  return smartFillTransform(photo, slot, faceCache.get(photo.id) ?? null);
}

// Rellena TODOS los huecos con foto de un lienzo, detectando caras donde haga falta.
// NO muta el spread: devuelve una copia con fit_mode/transform recalculados.
export async function applySmartFillToSpread(spread, photosById, projectId) {
  const slots = spread.slots || [];
  await Promise.all(
    slots
      .filter((sl) => sl.photo_id && photosById.get(sl.photo_id))
      .map((sl) => ensureFaces(projectId, photosById.get(sl.photo_id)))
  );
  return {
    ...spread,
    slots: slots.map((sl) => {
      const photo = sl.photo_id ? photosById.get(sl.photo_id) : null;
      if (!photo) return sl;
      const f = smartFillTransform(photo, sl, faceCache.get(sl.photo_id) ?? null);
      return { ...sl, fit_mode: f.fit_mode, transform: f.transform };
    }),
  };
}