// Persistencia de lotes de revelado IA: guarda los XMP ya procesados en localStorage
// para que el fotógrafo pueda pausar, cerrar el navegador y reanudar otro día. Las
// fotos que ya tienen XMP se saltan automáticamente al reanudar (sin repetir trabajo
// ni gastar créditos de IA). La clave es estable por carpeta (hash de nombres de
// archivo ordenados): la misma carpeta produce la misma clave en distintas sesiones.

const PREFIX = "editflow_batch_";

// Clave estable por carpeta: nombres de archivo ordenados y unidos por '|'.
// La misma carpeta produce la misma clave en distintas sesiones; carpetas
// distintas producan claves distintas (salvo colisión de nombres, poco probable).
export function computeFolderKey(photos) {
  if (!photos?.length) return "";
  const names = photos.map((p) => p.file?.name || "").filter(Boolean).sort();
  return names.join("|");
}

// Guarda los resultados parciales (solo los campos necesarios para reconstruir
// el XMP y descargar — sin la preview, que es grande y se recupera del RAW).
export function savePartialResults(folderKey, results) {
  if (!folderKey || !results?.length) return;
  try {
    const slim = results.map((r) => ({
      filename: r.filename,
      xmp: r.xmp,
      needsCorrection: r.needsCorrection,
      allZero: r.allZero,
      values: r.values,
      wb: r.wb,
    }));
    localStorage.setItem(PREFIX + folderKey, JSON.stringify({ results: slim, savedAt: Date.now() }));
  } catch {
    // localStorage lleno o no disponible — no bloquea el flujo.
  }
}

// Carga los resultados parciales guardados para una carpeta. Devuelve null si
// no hay nada guardado o si el JSON está corrupto.
export function loadPartialResults(folderKey) {
  if (!folderKey) return null;
  try {
    const raw = localStorage.getItem(PREFIX + folderKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.results || null;
  } catch {
    return null;
  }
}

// Borra los resultados parciales de una carpeta (al completar el lote o al
// descartar manualmente).
export function clearPartialResults(folderKey) {
  if (!folderKey) return;
  try {
    localStorage.removeItem(PREFIX + folderKey);
  } catch {}
}