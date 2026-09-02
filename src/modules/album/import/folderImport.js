// Fase 3.1 Bloque 1 — Importación local (Fase 1 §7) + identidad multicapa y previews
// de dos niveles. Carpeta exportada desde Lightroom → SOLO LECTURA → previews locales
// (thumb 256 / preview 1000) → catálogo del álbum. Los originales jamás se modifican
// ni se suben.
import { putPreview, photoThumbKey, photoPreviewKey, putFolderHandle } from "@/modules/album/lib/previewStore";
import { computeContentHash, computePHashFromDataUrl } from "@/modules/album/import/photoIdentity";

// Registro declarativo de formatos (Fase 3 §6): soportar TIFF u otros en el futuro es
// añadir una entrada aquí — previews, identidad y spreads son agnósticos del formato.
const SUPPORTED = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

export function isAlbumImage(name) {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  return !!SUPPORTED[ext] && !name.startsWith(".");
}

export async function pickFolder() {
  if (!window.showDirectoryPicker) {
    throw new Error("Este navegador no permite elegir carpetas; usa el selector de archivos.");
  }
  return window.showDirectoryPicker({ mode: "read" });
}

export async function filesFromHandle(handle) {
  const out = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !isAlbumImage(entry.name)) continue;
    out.push(await entry.getFile());
  }
  return out;
}

export function filesFromFileList(list) {
  return Array.from(list || []).filter((f) => isAlbumImage(f.name));
}

function decodeImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve({ img: i, url });
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No decodificable")); };
    i.src = url;
  });
}

function renderTo(img, w, h, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Bloque 4 — previews de dos niveles con UNA sola decodificación del archivo.
export async function makePreviews(file) {
  const { img, url } = await decodeImage(file);
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    return {
      thumb: renderTo(img, w, h, 256, 0.72),
      preview: renderTo(img, w, h, 1000, 0.82),
      orientation: Math.abs(w - h) < 1 ? "square" : w > h ? "landscape" : "portrait",
      width: w,
      height: h,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Bloque 1 — identidad multicapa (Fase 3 §2): tamaño + SHA-256 exacto + pHash de la
// preview + dimensiones reales. Calculado en el navegador, jamás enviado.
export async function computeFileIdentity(file, previews) {
  let content_hash = null;
  let phash = null;
  try { content_hash = await computeContentHash(file); } catch {}
  try { phash = await computePHashFromDataUrl(previews?.thumb); } catch {}
  return {
    file_size: file.size ?? null,
    content_hash,
    phash,
    width_px: previews?.width ?? null,
    height_px: previews?.height ?? null,
  };
}

// Bloque 6 + P1 — ingestión: SIEMPRE regenera las previews de cada archivo (así
// re-importar la misma carpeta las restaura en cualquier dispositivo); deduplica por
// nombre Y por content_hash (una foto renombrada se ENLAZA con su registro, nunca se
// duplica); solo son "nuevas" las fotos sin coincidencia en el catálogo. Los spreads y
// sus transformaciones jamás se tocan aquí.
export async function ingestFiles(projectId, files, existingPhotos = [], onProgress) {
  const byName = new Map(existingPhotos.map((p) => [p.filename, p]));
  const byHash = new Map(existingPhotos.filter((p) => p.content_hash).map((p) => [p.content_hash, p]));
  const newFiles = [];
  const refreshed = [];
  let done = 0;
  for (const f of files) {
    let previews = null;
    try { previews = await makePreviews(f); } catch { previews = null; }
    const identity = await computeFileIdentity(f, previews);
    const hashHit = identity.content_hash ? byHash.get(identity.content_hash) : null;
    const existing = hashHit || byName.get(f.name) || null;
    if (existing) {
      refreshed.push({ photo: existing, previews, identity, file: f, matchType: hashHit ? "hash" : "name" });
    } else {
      newFiles.push({ file: f, previews, identity });
    }
    done += 1;
    onProgress?.(done, files.length);
  }
  return { newFiles, refreshed };
}

export async function importFromPickedFolder(projectId, existingPhotos = [], onProgress) {
  const handle = await pickFolder();
  await putFolderHandle(projectId, handle);
  const files = await filesFromHandle(handle);
  const res = await ingestFiles(projectId, files, existingPhotos, onProgress);
  return { folderName: handle.name, ...res };
}

// Cachea los dos niveles bajo la clave ESTABLE de la foto (photo_id): restaurar o
// regenerar previews nunca afecta a spreads, layouts ni transformaciones.
export async function cachePhotoPreviews(projectId, photoId, previews) {
  if (!previews) return;
  if (previews.thumb) await putPreview(photoThumbKey(projectId, photoId), previews.thumb);
  if (previews.preview) await putPreview(photoPreviewKey(projectId, photoId), previews.preview);
}