// Recopilador de fotos: reúne TODAS las fotos de TODAS las carpetas del proyecto.
// Reutiliza listFingerprints(projectId) (ya recorre todas las carpetas) y
// getCachedPreview(hash) para cargar previews bajo demanda desde IndexedDB.
// NUNCA carga todas las previews a la vez: trabaja por lotes para no agotar la memoria.
import { listFingerprints } from "@/modules/proyectos/hooks/useProjectStore";
import { getCachedPreviews, getCachedPreview } from "@/modules/proyectos/lib/previewCache";

// Devuelve todos los fingerprints del proyecto (metadatos, sin previews).
// Cada entrada: { id, fingerprint_hash, filename, folder_id, capture_time, ... }
export async function gatherProjectPhotos(projectId) {
  const fps = await listFingerprints(projectId);
  return fps.map((f) => ({
    id: f.id,
    fingerprint_hash: f.fingerprint_hash,
    filename: f.filename,
    folder_id: f.folder_id || "",
    capture_time: f.capture_time || 0,
    camera_make: f.camera_make || "",
    camera_model: f.camera_model || "",
    selection_status: f.selection_status || "REVIEW",
  }));
}

// Carga un lote de previews desde IndexedDB. Devuelve Map<hash, dataUrl>.
// Solo carga las que existen en caché; las que no, se omiten (no se extraen del RAW
// aquí — el procesado de la carpeta ya las cacheó).
export async function loadBatchPreviews(hashes) {
  const valid = hashes.filter(Boolean);
  if (!valid.length) return new Map();
  return getCachedPreviews(valid);
}

// Carga UNA preview bajo demanda (para el visor de selección y el reproductor).
export async function loadPreview(hash) {
  if (!hash) return null;
  const p = await getCachedPreview(hash);
  return p?.dataUrl || null;
}

// Filtra las fotos que tienen preview disponible (las que ya fueron procesadas
// por el importador de carpetas). Las que no tienen preview no se pueden analizar.
export function photosWithPreview(photos, previewMap) {
  return photos.filter((p) => previewMap.has(p.fingerprint_hash));
}