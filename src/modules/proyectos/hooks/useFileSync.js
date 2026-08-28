import { useState, useCallback } from "react";
import { getHandleRecord, checkHandleAccessible, updateHandle } from "../lib/idbHandles";

// Verifica accesibilidad de los handles locales (carpeta RAW + .lrcat) SIN moverlos, copiarlos
// ni subirlos. 🟢 synced (ambos ok) / 🟡 partial (uno ok) / 🔴 missing (ninguno).
export function useFileSync() {
  const [checking, setChecking] = useState(false);

  const checkSync = useCallback(async (catalogRef, folderRef) => {
    setChecking(true);
    const folderRecord = await getHandleRecord(folderRef);
    const catalogRecord = catalogRef ? await getHandleRecord(catalogRef) : null;
    const folderOk = folderRecord ? await checkHandleAccessible(folderRecord.handle, "directory") : false;
    const catalogOk = catalogRecord ? await checkHandleAccessible(catalogRecord.handle, "file") : !catalogRef;
    setChecking(false);
    const status = folderOk && catalogOk ? "synced" : folderOk || catalogOk ? "partial" : "missing";
    return {
      status,
      folderOk,
      catalogOk,
      folderHandle: folderRecord?.handle || null,
      catalogHandle: catalogRecord?.handle || null,
    };
  }, []);

  const resyncFolder = useCallback(async (folderRef) => {
    const handle = await window.showDirectoryPicker();
    await updateHandle(folderRef, handle, { name: handle.name });
    return handle;
  }, []);

  const resyncCatalog = useCallback(async (catalogRef) => {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Catálogo Lightroom", accept: { "application/octet-stream": [".lrcat"] } }],
    });
    await updateHandle(catalogRef, handle, { name: handle.name });
    return handle;
  }, []);

  return { checking, checkSync, resyncFolder, resyncCatalog };
}