// Fase 3.1 Bloque 5 — Photo relocation (diseño Fase 3 §3). Niveles de confianza:
//   exact  → mismo SHA-256 (o nombre+tamaño si la foto es v1 sin hash): enlace automático
//   strong → nombre+tamaño (solo cuando no hay hash que verificar): enlace automático
//   fuzzy  → pHash dentro del umbral ESTRICTO: NUNCA automático, confirmación manual
// Regla de seguridad: una coincidencia perceptual JAMÁS enlaza sola (caso D).
import { makePreviews, computeFileIdentity } from "@/modules/album/import/folderImport";
import { phashHexDistance, FUZZY_PHASH_THRESHOLD } from "@/modules/album/import/photoIdentity";

// Escanea una carpeta candidata calculando identidad completa + previews de cada foto.
export async function scanCandidates(files, onProgress) {
  const out = [];
  let done = 0;
  for (const f of files) {
    let pv = null;
    try { pv = await makePreviews(f); } catch { pv = null; }
    const idn = await computeFileIdentity(f, pv);
    out.push({
      name: f.name,
      relative_path: f.name,
      file_size: idn.file_size,
      content_hash: idn.content_hash,
      phash: idn.phash,
      width_px: idn.width_px,
      height_px: idn.height_px,
      orientation: pv?.orientation || "landscape",
      thumb: pv?.thumb || null,
      preview: pv?.preview || null,
    });
    done += 1;
    onProgress?.(done, files.length);
  }
  return out;
}

// Empareja fotos sin preview contra los candidatos. Asignación greedy (un candidato
// no puede enlazarse a dos fotos). Devuelve { auto, fuzzy, unmatched }.
export function planRelocation(missingPhotos, candidates) {
  const used = new Set();
  const auto = [];
  const fuzzy = [];
  const unmatched = [];

  for (const photo of missingPhotos) {
    let assigned = false;
    if (photo.content_hash) {
      const c = candidates.find((x) => !used.has(x.name) && x.content_hash && x.content_hash === photo.content_hash);
      if (c) {
        used.add(c.name);
        auto.push({ photo, candidate: c, level: "exact" });
        assigned = true;
      }
    }
    if (!assigned && !photo.content_hash) {
      const s = candidates.find((x) => !used.has(x.name) && x.name === photo.filename && x.file_size === photo.file_size);
      if (s) {
        used.add(s.name);
        auto.push({ photo, candidate: s, level: "strong" });
        assigned = true;
      }
    }
    if (!assigned) {
      if (photo.phash) {
        const options = candidates
          .filter((x) => !used.has(x.name) && x.phash)
          .map((c) => ({ c, d: phashHexDistance(photo.phash, c.phash) }))
          .filter((x) => x.d <= FUZZY_PHASH_THRESHOLD)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .map((x) => ({ candidate: x.c, distance: x.d }));
        if (options.length) {
          fuzzy.push({ photo, options });
          continue;
        }
      }
      unmatched.push(photo);
    }
  }
  return { auto, fuzzy, unmatched };
}