// IndexedDB PROPIO del módulo Album AI (aislamiento total): previews reducidas y handle
// de la carpeta importada. Los archivos originales NUNCA se modifican (solo lectura).
const DB_NAME = "editflow-album-db";
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("previews")) d.createObjectStore("previews");
        if (!d.objectStoreNames.contains("handles")) d.createObjectStore("handles");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );
}

export const previewKey = (projectId, filename) => `${projectId}::${filename}`;

export async function putPreview(key, dataUrl) {
  try { return await tx("previews", "readwrite", (s) => s.put(dataUrl, key)); } catch { return null; }
}

export async function getPreview(key) {
  try { return await tx("previews", "readonly", (s) => s.get(key)); } catch { return null; }
}

// Fase 3.1 Bloque 4 — previews de dos niveles bajo la clave ESTABLE de la foto
// (photo_id). Mantienen el prefijo projectId:: para que la limpieza por álbum
// existente los cubra. Las claves legadas (projectId::filename) siguen legibles
// como fallback de proyectos creados en Fase 2.
export const photoThumbKey = (projectId, photoId) => `${projectId}::${photoId}::thumb`;
export const photoPreviewKey = (projectId, photoId) => `${projectId}::${photoId}::preview`;

export function putTierPreview(projectId, photoId, tier, dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  return putPreview(tier === "thumb" ? photoThumbKey(projectId, photoId) : photoPreviewKey(projectId, photoId), dataUrl);
}

export async function getTierPreview(projectId, photoId, tier) {
  return getPreview(tier === "thumb" ? photoThumbKey(projectId, photoId) : photoPreviewKey(projectId, photoId));
}

export async function putFolderHandle(projectId, handle) {
  try { return await tx("handles", "readwrite", (s) => s.put(handle, projectId)); } catch { return null; }
}

export async function getFolderHandle(projectId) {
  try { return await tx("handles", "readonly", (s) => s.get(projectId)); } catch { return null; }
}

// Fase Guardado (⌘+S) — handle del ARCHIVO .editflowalbum vinculado al proyecto.
// Vive en el mismo store "handles" con clave prefijada "file::"; la limpieza al
// eliminar el álbum también lo cubre. Dispositivo-local, no toca el formato.
const fileHandleKey = (projectId) => `file::${projectId}`;

export async function putAlbumFileHandle(projectId, handle) {
  try { return await tx("handles", "readwrite", (s) => s.put(handle, fileHandleKey(projectId))); } catch { return null; }
}

export async function getAlbumFileHandle(projectId) {
  try { return await tx("handles", "readonly", (s) => s.get(fileHandleKey(projectId))); } catch { return null; }
}

// Limpieza al eliminar un álbum: previews y handle locales.
export function deleteProjectData(projectId) {
  return db().then(
    (d) =>
      new Promise((resolve) => {
        const t = d.transaction(["previews", "handles"], "readwrite");
        const ps = t.objectStore("previews");
        const req = ps.getAllKeys();
        req.onsuccess = () => {
          req.result.forEach((k) => { if (String(k).startsWith(projectId + "::")) ps.delete(k); });
          resolve();
        };
        req.onerror = () => resolve();
        t.objectStore("handles").delete(projectId);
        t.objectStore("handles").delete(`file::${projectId}`);
      })
  );
}