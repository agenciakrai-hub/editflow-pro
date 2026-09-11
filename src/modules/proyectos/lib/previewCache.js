// Caché local (IndexedDB) de previews decodificadas, keyed by fingerprint_hash.
// Permite mostrar las imágenes al instante al reabrir un proyecto, sin volver a
// extraerlas de la carpeta RAW. Las previews NUNCA salen del navegador.
// Módulo aislado — no toca ningún motor de edición existente.

const DB_NAME = "editflow_previews_local";
const STORE = "previews";

function openDb() {
  return new Promise((resolve, reject) => {
    // v3: se añade el preview de ALTA RESOLUCIÓN (2400px, 95% JPEG) junto al de
    // 800px para el visor. La caché vieja (v2) no tiene hiResDataUrl: se borra para
    // forzar la re-extracción con ambos previews al reabrir el proyecto.
    const req = indexedDB.open(DB_NAME, 3);
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

// entries: [{ hash, dataUrl, hiResDataUrl }]
// Se almacena un objeto { lo: dataUrl, hi: hiResDataUrl } por hash. El preview lo
// (800px) sirve para la galería y el análisis IA; el hi (2400px) para el visor.
export async function cachePreviews(entries) {
  if (!entries?.length) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    for (const e of entries) {
      if (e.hash && e.dataUrl) tx.objectStore(STORE).put({ lo: e.dataUrl, hi: e.hiResDataUrl || null }, e.hash);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// hashes: string[] -> Map<hash, { dataUrl, hiResDataUrl }>
export async function getCachedPreviews(hashes) {
  const db = await openDb();
  const map = new Map();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    for (const h of hashes) {
      if (!h) continue;
      const r = store.get(h);
      r.onsuccess = () => {
        if (!r.result) return;
        // Compatibilidad: la caché v2 guardaba un string suelto (solo dataUrl).
        // La v3 guarda { lo, hi }. Se normalizan ambos al formato esperado.
        if (typeof r.result === "string") map.set(h, { dataUrl: r.result, hiResDataUrl: null });
        else map.set(h, { dataUrl: r.result.lo, hiResDataUrl: r.result.hi || null });
      };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return map;
}