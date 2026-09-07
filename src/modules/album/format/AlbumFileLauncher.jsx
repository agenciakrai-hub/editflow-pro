import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { importOpenedAlbumFile } from "@/modules/album/format/albumFileIO";

// Fase C — apertura directa de archivos: cuando el sistema operativo lanza la
// aplicación (PWA instalada con asociación .editflowalbum) con un archivo, la File
// Handling API lo entrega en window.launchQueue. Se valida, se importa como álbum y
// se entra directamente en el editor, con la ruta ya vinculada (⌘+S guarda sobre el
// mismo archivo). Si el navegador no soporta launchQueue, este componente no hace
// nada (la apertura manual/drag-drop de Mis álbumes sigue disponible).
export default function AlbumFileLauncher() {
  const navigate = useNavigate();
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current || typeof window.launchQueue?.setConsumer !== "function") return;
    doneRef.current = true;
    window.launchQueue.setConsumer(async (params) => {
      const files = params?.files || [];
      const entry = files.find((f) => String(f?.name || "").toLowerCase().endsWith(".editflowalbum"));
      if (!entry) return;
      try {
        const proj = await importOpenedAlbumFile(entry, null);
        navigate(`/album?project=${proj.id}`);
      } catch (e) {
        console.error("[album-launch] no se pudo abrir el archivo .editflowalbum", e);
      }
    });
  }, [navigate]);

  return null;
}