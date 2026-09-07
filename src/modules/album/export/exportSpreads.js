// Orquestación de exportación de LIENZOS: resuelve la escala, renderiza cada lienzo
// con spreadRenderer (motor único) y escribe los archivos en la carpeta elegida
// (File System Access) o como descargas individuales si el navegador no lo soporta.
// Nunca modifica el proyecto: solo lee.
import { preloadSpreadImages, renderSpreadToCanvas } from "@/modules/album/export/spreadRenderer";

const sanitizeName = (n) =>
  (n || "album").replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, "").trim().replace(/\s+/g, "-") || "album";

export function supportsFolderExport() {
  return typeof window.showDirectoryPicker === "function";
}

export async function pickExportFolder() {
  if (!supportsFolderExport()) return null;
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return null; // cancelado
  }
}

function canvasToBlob(canvas, format, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      format === "png" ? "image/png" : "image/jpeg",
      format === "png" ? undefined : quality
    );
  });
}

// options: { folderHandle, format: "jpeg"|"png", quality (0-1), pxPerMm,
//            includeBleed, overlays }
// Devuelve { count, missing, mode: "folder"|"download" }.
export async function exportSpreads({ album, spreads, photosById, options, onProgress }) {
  const { folderHandle, format = "jpeg", quality = 0.92, pxPerMm, includeBleed = false, overlays = null } = options;
  const images = new Map();
  const ext = format === "png" ? "png" : "jpg";
  let missing = 0;
  for (let i = 0; i < spreads.length; i++) {
    const spread = spreads[i];
    await preloadSpreadImages(album.id, spread, photosById, images);
    const { canvas, missingCount } = renderSpreadToCanvas(album, spread, images, {
      pxPerMm,
      includeBleed,
      overlays: overlays ? { ...overlays, lienzoNumber: i + 1, lienzoTotal: spreads.length } : null,
      photosById,
    });
    missing += missingCount;
    const fileName = `${sanitizeName(album.name)}-lienzo-${String(i + 1).padStart(2, "0")}.${ext}`;
    const blob = await canvasToBlob(canvas, format, quality);
    if (folderHandle) {
      const fh = await folderHandle.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      await new Promise((r) => setTimeout(r, 300)); // respiración entre descargas
    }
    onProgress?.(i + 1, spreads.length, fileName);
  }
  return { count: spreads.length, missing, mode: folderHandle ? "folder" : "download" };
}