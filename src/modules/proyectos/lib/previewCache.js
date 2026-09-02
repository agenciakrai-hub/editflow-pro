// Caché local (IndexedDB) de previews decodificadas, keyed by fingerprint_hash.
// Permite mostrar las imágenes al instante al reabrir un proyecto, sin volver a
// extraerlas de la carpeta RAW. Las previews NUNCA salen del navegador.
// Módulo aislado — no toca ningún motor de edición existente.

const DB_NAME = "editflow_previews_local";
const STORE = "previews";

function openDb() {
  return new Promise((resolve, reject) => {
    // v2: las previews cacheadas en v1 se generaron sin aplicar la orientación EXIF
    // correcta (las fotos verticales aparecían tumbadas). Se borra la caché vieja para
    // forzar la re-extracción con la orientación corregida al reabrir el proyecto.
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) {
        try { db.deleteObjectStore(STORE); } catch {}
      }
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// entries: [{ hash, dataUrl }]
export async function cachePreviews(entries) {
  if (!entries?.length) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const e of entries) {
      if (e.hash && e.dataUrl) tx.objectStore(STORE).put(e.dataUrl, e.hash);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// hashes: string[] -> Map<hash, dataUrl>
export async function getCachedPreviews(hashes) {
  const db = await openDb();
  const map = new Map();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    for (const h of hashes) {
      if (!h) continue;
      const r = store.get(h);
      r.onsuccess = () => { if (r.result) map.set(h, r.result); };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return map;
}