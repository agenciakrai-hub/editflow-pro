// Almacén local (IndexedDB) de FileSystemHandle. Los handles NUNCA salen del navegador:
// en la nube solo se persiste el "ref" (string opaco, ver saveHandle) que apunta aquí.
// Este módulo es nuevo y aislado — no toca ningún archivo del motor de edición existente.

const DB_NAME = "editflow_projects_local";
const STORE = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "ref" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function genRef() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `ref_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Guarda un handle nuevo y devuelve un ref opaco (esto es lo único que puede subirse a la nube).
export async function saveHandle(handle, type, meta = {}) {
  const db = await openDb();
  const ref = genRef();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ref, type, handle, meta });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return ref;
}

export async function getHandleRecord(ref) {
  if (!ref) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(ref);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Actualiza el handle de un ref ya existente (re-sincronización tras mover carpeta/catálogo).
// El ref opaco en la nube NO cambia — solo el handle local que apunta.
export async function updateHandle(ref, handle, meta = {}) {
  const db = await openDb();
  const existing = await getHandleRecord(ref);
  const type = existing?.type;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ref, type, handle, meta });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeHandle(ref) {
  if (!ref) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(ref);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyReadPermission(handle) {
  if (!handle) return false;
  try {
    const q = await handle.queryPermission?.({ mode: "read" });
    if (q === "granted") return true;
    const p = await handle.requestPermission?.({ mode: "read" });
    return p === "granted";
  } catch {
    return false;
  }
}

// Comprueba si el handle sigue apuntando a algo accesible (movido/borrado -> false). Solo
// lectura: nunca mueve, copia, modifica ni sube el archivo/carpeta real.
export async function checkHandleAccessible(handle, type) {
  if (!handle) return false;
  const granted = await verifyReadPermission(handle);
  if (!granted) return false;
  try {
    if (type === "file") {
      await handle.getFile();
    } else {
      const iterator = handle.values();
      await iterator.next();
    }
    return true;
  } catch {
    return false;
  }
}