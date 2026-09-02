import { useEffect, useState } from "react";
import { loadPreview } from "@/modules/album/lib/previewService";

// Fase 3.1 Bloque 4 — el hueco carga su preview de nivel 2 (1000 px) BAJO DEMANDA con
// LRU compartido: nunca se cargan todas las fotos en memoria, solo las visibles.
export default function usePhotoPreview(projectId, photoId, filename) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!photoId) return undefined;
    loadPreview(projectId, photoId, filename)
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId, photoId, filename]);
  return url;
}