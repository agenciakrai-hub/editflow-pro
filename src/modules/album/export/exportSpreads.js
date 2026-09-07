// Orquestación de exportación de LIENZOS — NIVEL 4 DE CALIDAD: las imágenes SIEMPRE
// salen del ARCHIVO ORIGINAL, generadas a la resolución exacta que cada hueco necesita
// a la resolución de salida configurada (nunca miniaturas, ni previews, ni capturas
// del canvas). Solo si el original no está accesible en este dispositivo (carpeta no
// vinculada) se degrada a la preview guardada, contándolo para avisar al usuario.
// El proyecto nunca se modifica: todo es lectura.
import { renderSpreadToCanvas, getBestPreviewUrl } from "@/modules/album/export/spreadRenderer";
import { findOriginalFile, renderScaledFromOriginal, loadUrlImage } from "@/modules/album/lib/originalSource";

const sanitizeName = (n) =>
  (n || "album").replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, "").trim().replace(/\s+/g, "-") || "album";

const LOW_RES_DPI = 150; // umbral mínimo razonable para impresión

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

// REGLA ABSOLUTA (Para impresión = SOLO ARCHIVOS ORIGINALES): antes de escribir nada,
// se verifica que TODOS los originales de los lienzos seleccionados estén accesibles.
// Si falta alguno, la exportación queda DETENIDA (0 archivos generados) y se informa
// exactamente de qué fotografías faltan para que el usuario las localice/re-vincule.
// El fallback a previews SOLO existe para la revisión manual, nunca para impresión.
async function findMissingOriginals(album, spreads, photosById) {
  const missing = [];
  const seen = new Set();
  for (const spread of spreads) {
    for (const sl of (spread.slots || [])) {
      if (!sl.photo_id || seen.has(sl.photo_id)) continue;
      seen.add(sl.photo_id);
      const photo = photosById.get(sl.photo_id);
      if (!photo) { missing.push({ photo_id: sl.photo_id, filename: sl.photo_id }); continue; }
      const file = await findOriginalFile(album.id, photo);
      if (!file) missing.push({ photo_id: sl.photo_id, filename: photo.filename });
    }
  }
  return missing;
}

// Carga las imágenes de UN lienzo para exportación, desde el ORIGINAL. Cada foto se
// decodifica UNA A UNA a la resolución necesaria; tras renderizar el lienzo se
// liberan (releaseImages) para que la memoria no crezca con el número de lienzos.
async function loadSpreadImages(album, spread, photosById, pxPerMm, requireOriginals) {
  const images = new Map();
  const meta = new Map();
  // Cuerpo de carga de UNA foto: siempre secuencial (nunca dos originales
  // decodificados a la vez) para mantener la memoria acotada.
  const loadOne = async (sl) => {
    const photo = photosById.get(sl.photo_id);
    if (!photo) {
      images.set(sl.photo_id, null);
      meta.set(sl.photo_id, { source: "missing", url: null, ow: null, oh: null });
      return;
    }
    const scale = sl.transform?.scale ?? 1;
    const requiredEdge = Math.ceil(Math.max(sl.w_mm, sl.h_mm) * pxPerMm * scale);
    const file = await findOriginalFile(album.id, photo);
    if (file) {
      try {
        const r = await renderScaledFromOriginal(file, requiredEdge, 0.95);
        if (r?.url) {
          images.set(sl.photo_id, await loadUrlImage(r.url));
          meta.set(sl.photo_id, { source: "original", url: r.url, ow: r.width, oh: r.height });
          return;
        }
      } catch {}
    }
    // Fallback controlado: SOLO para revisión manual (baja resolución explícita).
    // Para impresión jamás se sustituye un original por una preview.
    const url = requireOriginals ? null : await getBestPreviewUrl(album.id, photo);
    const img = url ? await loadUrlImage(url).catch(() => null) : null;
    images.set(sl.photo_id, img);
    meta.set(sl.photo_id, {
      source: img ? "preview" : "missing",
      url: null,
      ow: photo.width_px || null,
      oh: photo.height_px || null,
    });
  };
  for (const sl of (spread.slots || [])) {
    if (!sl.photo_id || images.has(sl.photo_id)) continue;
    await loadOne(sl);
  }
  return { images, meta };
}

function releaseImages(meta) {
  meta.forEach((m) => { if (m?.url) { try { URL.revokeObjectURL(m.url); } catch {} } });
}

// options: { folderHandle, format: "jpeg"|"png", quality (0-1), pxPerMm,
//            includeBleed, overlays, checkResolution, requireOriginals }
// Devuelve { count, missing, fromPreview, lowRes[], mode } o, si requireOriginals y
// falta algún original, { blocked: true, missingOriginals[], count: 0 }.
export async function exportSpreads({ album, spreads, photosById, options, onProgress }) {
  const {
    folderHandle, format = "jpeg", quality = 0.92, pxPerMm,
    includeBleed = false, overlays = null, checkResolution = false, requireOriginals = false,
  } = options;

  // Para impresión: SIEMPRE originales. Si falta uno, no se genera NADA y se
  // detiene para una decisión explícita del usuario (localizar / re-vincular).
  if (requireOriginals) {
    const missingOriginals = await findMissingOriginals(album, spreads, photosById);
    if (missingOriginals.length) {
      return { blocked: true, missingOriginals, count: 0 };
    }
  }
  const ext = format === "png" ? "png" : "jpg";
  let missing = 0;
  const fromPreview = new Set();
  const lowRes = [];
  const lowResSeen = new Set();

  for (let i = 0; i < spreads.length; i++) {
    const spread = spreads[i];
    const { images, meta } = await loadSpreadImages(album, spread, photosById, pxPerMm, requireOriginals);
    meta.forEach((m, pid) => { if (m.source === "preview") fromPreview.add(pid); });

    // Control de resolución (impresión): DPI efectivo real del ORIGINAL en el tamaño
    // físico que ocupa la foto dentro del lienzo. Solo AVISA, nunca bloquea.
    if (checkResolution) {
      (spread.slots || []).forEach((sl) => {
        if (!sl.photo_id || lowResSeen.has(sl.photo_id)) return;
        const m = meta.get(sl.photo_id);
        const photo = photosById.get(sl.photo_id);
        if (!m || !m.ow || !m.oh || !photo) return;
        const effDpi = Math.min(m.ow / (sl.w_mm / 25.4), m.oh / (sl.h_mm / 25.4));
        if (effDpi < LOW_RES_DPI) {
          lowResSeen.add(sl.photo_id);
          lowRes.push({ filename: photo.filename, dpi: Math.round(effDpi) });
        }
      });
    }

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

    // Memoria acotada: las imágenes grandes de este lienzo se liberan ya.
    releaseImages(meta);
    onProgress?.(i + 1, spreads.length, fileName);
  }

  return {
    count: spreads.length,
    missing,
    fromPreview: fromPreview.size,
    lowRes,
    mode: folderHandle ? "folder" : "download",
  };
}