// Fase 3.1 Bloque 4 — servicio de previews bajo demanda: IDB (dos niveles, clave
// photo_id) + LRU en RAM + fallback a claves legadas de Fase 2 (projectId::filename).
import { getPreview, getTierPreview, previewKey } from "@/modules/album/lib/previewStore";
import { createLru } from "@/modules/album/lib/previewLru";

const lru = createLru(48);

export async function loadPreview(projectId, photoId, filename) {
  const hit = lru.get(photoId);
  if (hit) return hit;
  let url = await getTierPreview(projectId, photoId, "preview");
  if (!url && filename) url = await getPreview(previewKey(projectId, filename)); // legado Fase 2
  if (url) lru.put(photoId, url);
  return url || null;
}