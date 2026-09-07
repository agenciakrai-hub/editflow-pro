// Fase 3.1 Bloque 4 — servicio de previews bajo demanda: IDB (dos niveles, clave
// photo_id) + LRU en RAM + fallback a claves legadas de Fase 2 (projectId::filename).
//
// Calidad dinámica — NIVEL 3: loadHiResPreview genera BAJO DEMANDA una versión desde
// el ARCHIVO ORIGINAL cuando el hueco se muestra en pantalla más grande de lo que la
// preview de nivel 2 (1000 px) cubre (lienzo grande o zoom). Solo para las fotos que
// lo necesitan, una a una, con LRU propio que libera los blob URLs automáticamente.
// Nunca se cargan todos los originales simultáneamente.
import { getPreview, getTierPreview, previewKey } from "@/modules/album/lib/previewStore";
import { createLru } from "@/modules/album/lib/previewLru";
import { findOriginalFile, renderScaledFromOriginal } from "@/modules/album/lib/originalSource";

const lru = createLru(48);

const HI_MIN_EDGE = 1280;  // por debajo de esto, la preview de 1000 px es suficiente
const HI_MAX_EDGE = 4096;  // techo de memoria por versión generada
// LRU de hi-res (blob URLs): al expirar una entrada su blob se libera de memoria.
const hiLru = createLru(10, (v) => { try { if (v) URL.revokeObjectURL(v); } catch {} });

export async function loadPreview(projectId, photoId, filename) {
  const hit = lru.get(photoId);
  if (hit) return hit;
  let url = await getTierPreview(projectId, photoId, "preview");
  if (!url && filename) url = await getPreview(previewKey(projectId, filename)); // legado Fase 2
  if (url) lru.put(photoId, url);
  return url || null;
}

// requiredEdge = lado mayor en px de pantalla que la foto debe cubrir nítida.
// Redondeo por pasos de 512 para no regenerar en cada píxel de zoom.
export async function loadHiResPreview(projectId, photoId, filename, photo, requiredEdge) {
  if (!photo || !requiredEdge || requiredEdge < HI_MIN_EDGE) return null;
  const edge = Math.min(HI_MAX_EDGE, Math.ceil(requiredEdge / 512) * 512);
  const key = `${photoId}::${edge}`;
  const hit = hiLru.get(key);
  if (hit) return hit;
  const file = await findOriginalFile(projectId, photo);
  if (!file) return null; // carpeta original no disponible → se queda en la preview guardada
  try {
    const { url } = await renderScaledFromOriginal(file, edge, 0.9);
    if (!url) return null;
    hiLru.put(key, url);
    return url;
  } catch {
    return null;
  }
}