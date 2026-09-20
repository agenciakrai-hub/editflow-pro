// MAQUETAR DESDE JPG — Orquestador: selecciona carpeta de JPG editados, lee sus
// metadatos XMP localmente, los relaciona con las fotos del proyecto por nombre
// de archivo y construye roleOf (Map<photoId, role>) + resumen de clasificación.
//
// NO envía nada a IA. NO modifica los JPG. NO copia ni mueve archivos. Solo lee.
// El resultado alimenta al planificador existente (autoPlanner) con mejores
// datos: la baseline NO se toca.
import { pickFolder, filesFromHandle, isAlbumImage } from "@/modules/album/import/folderImport";
import { readJpgXmp } from "@/modules/album/xmp/jpgXmpReader";
import { classifyFromXmp, roleForClassification, baseName, CLASSIFICATION, isMaquetable } from "@/modules/album/xmp/classificationMapper";

// Clasifica los JPG de una carpeta seleccionada por el usuario y los relaciona
// con las fotos del proyecto. Devuelve { summary, roleOf, maquetableIds,
// unclassifiedPhotos, folderName }.
//
// summary: { total, TOP, VALID, REVIEW, UNCLASSIFIED, matched, unmatched }
// roleOf: Map<photoId, "hero"|"support"> — solo TOP + VALID
// maquetableIds: [photoId] — fotos TOP + VALID listas para maquetar (orden del catálogo)
// unclassifiedPhotos: [{ photo, file }] — fotos sin clasificar (para análisis opcional)
export async function classifyJpgFolder(projectPhotos) {
  const handle = await pickFolder();
  const files = await filesFromHandle(handle);

  // Índice por base name (sin extensión, mayúsculas) para matching JPG ↔ foto.
  const byBaseName = new Map();
  for (const p of projectPhotos) {
    byBaseName.set(baseName(p.filename), p);
  }

  const summary = { total: 0, [CLASSIFICATION.TOP]: 0, [CLASSIFICATION.VALID]: 0, [CLASSIFICATION.REVIEW]: 0, [CLASSIFICATION.UNCLASSIFIED]: 0, matched: 0, unmatched: 0 };
  const roleOf = new Map();
  const maquetableIds = [];
  const unclassifiedPhotos = [];
  const classifiedEntries = []; // { photo, classification }

  for (const file of files) {
    if (!isAlbumImage(file.name)) continue;
    summary.total++;
    const xmp = await readJpgXmp(file);
    const classification = classifyFromXmp(xmp.rating, xmp.label);
    summary[classification]++;

    const photo = byBaseName.get(baseName(file.name));
    if (photo) {
      summary.matched++;
      classifiedEntries.push({ photo, classification });
      if (classification === CLASSIFICATION.UNCLASSIFIED) {
        unclassifiedPhotos.push({ photo, file });
      }
    } else {
      summary.unmatched++;
    }
  }

  // Ordenar maquetables por orden del catálogo (orden de projectPhotos).
  const orderIndex = new Map(projectPhotos.map((p, i) => [p.id, i]));
  for (const entry of classifiedEntries) {
    if (!isMaquetable(entry.classification)) continue;
    const role = roleForClassification(entry.classification);
    roleOf.set(entry.photo.id, role);
    maquetableIds.push(entry.photo.id);
  }
  maquetableIds.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

  return { summary, roleOf, maquetableIds, unclassifiedPhotos, folderName: handle.name };
}