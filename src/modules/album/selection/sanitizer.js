// Fase 4.1 Bloque 2 — SANITIZACIÓN ANTES DE CADA ENVÍO REMOTO (regla Fase 4.0.1):
// la preview local (ya re-codificada por canvas en la importación) se vuelve a
// RE-CODIFICAR a JPEG ≤512 px q0.75 → sin EXIF, sin GPS, sin metadatos, con
// resolución y peso limitados. Ninguna imagen sale del dispositivo sin pasar por aquí.
const AI_MAX_EDGE = 512;
const AI_QUALITY = 0.75;
const AI_MAX_BYTES = 100 * 1024; // tope por imagen de análisis (toques duros 4.0.1)

export function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(",");
  return Math.round(((dataUrl.length - (i + 1)) * 3) / 4);
}

function decode(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("preview no decodificable"));
    img.src = dataUrl;
  });
}

// ORIGINAL LOCAL → PREVIEW LOCAL → RE-CODIFICACIÓN → SIN METADATOS → DATA URL.
// El canvas SOLO copia píxeles: EXIF/GPS/XMP del archivo original no viajan jamás.
export async function sanitizeForAi(dataUrl, maxEdge = AI_MAX_EDGE) {
  const img = await decode(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  let q = AI_QUALITY;
  let out = canvas.toDataURL("image/jpeg", q);
  while (dataUrlBytes(out) > AI_MAX_BYTES && q > 0.4) {
    q = Math.round((q - 0.1) * 100) / 100;
    out = canvas.toDataURL("image/jpeg", q);
  }
  return { dataUrl: out, width: w, height: h, bytes: dataUrlBytes(out), quality: q };
}