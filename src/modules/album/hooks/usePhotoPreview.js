import { useEffect, useState } from "react";
import { loadPreview, loadHiResPreview } from "@/modules/album/lib/previewService";

// Calidad DINÁMICA del lienzo (niveles 2 → 3): primero la preview almacenada de
// nivel 2 (1000 px, IDB + LRU, inmediata); si el hueco se está mostrando en pantalla
// más grande de lo que esa preview cubre (requiredEdge = tamaño del hueco × zoom del
// lienzo), se genera bajo demanda una versión desde el ORIGINAL. El LRU hi-res libera
// las versiones grandes automáticamente. Nunca se cargan todos los originales.
export default function usePhotoPreview(projectId, photoId, filename, requiredEdge = 0, photo = null) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!photoId) return undefined;
    (async () => {
      const base = await loadPreview(projectId, photoId, filename);
      if (!alive) return;
      setUrl(base);
      if (requiredEdge && photo) {
        const hi = await loadHiResPreview(projectId, photoId, filename, photo, requiredEdge);
        if (alive && hi) setUrl(hi); // mejora progresiva: nunca vuelve a bajar salvo zoom menor
      }
    })().catch(() => {});
    return () => { alive = false; };
  }, [projectId, photoId, filename, requiredEdge, photo]);
  return url;
}