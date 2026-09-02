// Importación local de fotografías (Fase 1 §7): carpeta JPEG exportada desde Lightroom
// → SOLO LECTURA → previews reducidas locales (IndexedDB propio) → catálogo del álbum.
// Los archivos originales jamás se modifican ni se suben.
import { putPreview, previewKey, putFolderHandle } from "@/modules/album/lib/previewStore";

const IMG_RE = /\.(jpe?g|png)$/i;

export function isAlbumImage(name) {
  return IMG_RE.test(name) && !name.startsWith(".");
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

// Preview reducida (maxEdge px) decodificada en el navegador. Nunca escribe en disco.
export async function makePreview(file, maxEdge = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No decodificable"));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const orientation = Math.abs(w - h) < 1 ? "square" : w > h ? "landscape" : "portrait";
    return { dataUrl, orientation, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Convierte archivos en metadatos AlbumPhoto + previews locales. Ignora duplicados por
// nombre dentro del mismo proyecto ("añadir más fotos después" es seguro).
export async function ingestFiles(projectId, files, existingNames, onProgress) {
  const metas = [];
  let done = 0;
  for (const f of files) {
    if (!existingNames.has(f.name)) {
      let p = null;
      try { p = await makePreview(f); } catch { p = null; }
      if (p?.dataUrl) await putPreview(previewKey(projectId, f.name), p.dataUrl);
      metas.push({
        project_id: projectId,
        filename: f.name,
        relative_path: f.webkitRelativePath || f.name,
        orientation: p?.orientation || "landscape",
        capture_time: f.lastModified || null,
        preview_status: p?.dataUrl ? "ok" : "missing",
        ai_state: "unreviewed",
      });
    }
    done += 1;
    onProgress?.(done, files.length);
  }
  return metas;
}

export async function importFromPickedFolder(projectId, existingNames, onProgress) {
  const handle = await pickFolder();
  await putFolderHandle(projectId, handle);
  const files = await filesFromHandle(handle);
  const metas = await ingestFiles(projectId, files, existingNames, onProgress);
  return { folderName: handle.name, metas };
}