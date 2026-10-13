// NIVEL 4 — acceso a los ARCHIVOS ORIGINALES (solo lectura) a través del handle de
// la carpeta importada que ya vive en IndexedDB (previewStore). El editor (huecos
// grandes en pantalla, zoom) y la EXPORTACIÓN generan versiones desde el ORIGINAL a
// la resolución exacta necesaria. Los originales jamás se modifican ni se suben.
import { getFolderHandle } from "@/modules/album/lib/previewStore";

async function projectFolder(projectId) {
  // Releer el handle permite usar una carpeta recién vinculada sin recargar.
  try { return await getFolderHandle(projectId); } catch { return null; }
}

// Localiza el archivo ORIGINAL de una foto en la carpeta vinculada del proyecto.
// Devuelve null si la carpeta no está disponible en este dispositivo: en ese caso
// la UI degrada a la preview guardada (avisando en la exportación).
export async function findOriginalFile(projectId, photo) {
  if (!projectId || !photo) return null;
  const dir = await projectFolder(projectId);
  if (!dir) return null;
  const paths = [...new Set([photo.relative_path, photo.filename].filter(Boolean))];
  for (const p of paths) {
    try {
      const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.some(part => part === ".." || part.includes(":"))) continue;
      if (parts.length > 1 && parts[0] === dir.name) parts.shift();
      if (!parts.length) continue;
      let folder = dir;
      for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
      const fh = await folder.getFileHandle(parts.at(-1));
      return await fh.getFile();
    } catch {}
  }
  // No cachear el handle fallido: reintenta tras volver a vincular la carpeta.
  return null;
}

export function loadUrlImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No decodificable"));
    img.src = url;
  });
}

// Genera desde el ORIGINAL una imagen JPEG escalada al tamaño necesario (nunca por
// encima de la resolución real del archivo). Devuelve { url (blob), width, height }:
// width/height son las dimensiones REALES del original (para el análisis de DPI).
// El archivo original se decodifica UNO A LA VEZ y el blob temporal se libera.
export async function renderScaledFromOriginal(file, targetEdge = 0, quality = 0.92) {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await loadUrlImage(srcUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const edge = typeof targetEdge === "function" ? targetEdge(w, h) : targetEdge;
    const scale = edge > 0 ? Math.min(1, edge / Math.max(w, h)) : 1;
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), width: w, height: h };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}