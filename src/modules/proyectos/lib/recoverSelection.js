// Puente hacia el flujo de edición existente. Reutiliza EXCLUSIVAMENTE el contrato ya
// exportado por src/lib/rawaistudio/localSession.js (setSession) — este archivo NO se
// modifica, solo se importa. Así "Volver a editar selección" no requiere tocar el motor.
import { setSession } from "@/lib/rawaistudio/localSession";

// Construye el array de fotos seleccionadas con la MISMA forma que espera AjustesIA
// (session.photos: {id, file, preview, manualRotation, rating, colorLabel, ...}).
// Solo incluye TOP_PICK/SELECT — coincide con el criterio de "seleccionadas" del motor.
export function buildSelectedPhotosArray(matches, previewByHash = new Map()) {
  return matches
    .filter(
      (m) =>
        m.matched &&
        m.candidate &&
        (m.saved.selection_status === "TOP_PICK" || m.saved.selection_status === "SELECT")
    )
    .map((m) => {
      // Preview: la del candidato (carpeta accesible, ya extraída) o, si no existe,
      // la cacheada en IndexedDB (vía fingerprint_hash). Así la sesión siempre lleva
      // dataUrl aunque la carpeta RAW no sea accesible al reabrir el proyecto.
      const cached = previewByHash.get(m.saved.fingerprint_hash);
      return {
        id: m.candidate.id,
        file: m.candidate.file,
        preview: m.candidate.preview || (cached ? { dataUrl: cached.dataUrl, hiResDataUrl: cached.hiResDataUrl } : null),
        manualRotation: 0,
        rating: m.saved.rating || 0,
        colorLabel: m.saved.color_label || "none",
        cameraInfo: m.candidate.cameraInfo || null,
        asShotWB: m.candidate.asShotWB || null,
        skinStats: m.candidate.skinStats || null,
      };
    });
}

export function loadSelectionIntoSession(selectedPhotosArray) {
  setSession({ photos: selectedPhotosArray });
}