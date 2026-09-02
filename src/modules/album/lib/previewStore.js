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

export async function putFolderHandle(projectId, handle) {
  try { return await tx("handles", "readwrite", (s) => s.put(handle, projectId)); } catch { return null; }
}

export async function getFolderHandle(projectId) {
  try { return await tx("handles", "readonly", (s) => s.get(projectId)); } catch { return null; }
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
      })
  );
}