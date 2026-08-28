// Fingerprint robusto de fotografías para el módulo de Proyectos. Reutiliza (SOLO importa,
// no modifica) computePHash/phashDistance/phashHex, readCaptureTimeFromBytes y
// readCameraMetadataFromBytes ya existentes en el motor de Selección.
import { computePHash, phashDistance, phashHex } from "@/lib/rawaistudio/perceptualHash";
import { readCaptureTimeFromBytes } from "@/lib/rawaistudio/captureTime";
import { readCameraMetadataFromBytes } from "@/lib/rawaistudio/cameraMetadata";

// Construye el fingerprint de una foto ya extraída (preview.dataUrl/decodedSource disponibles).
// Identidad principal: phash + captureTime + cameraMake + cameraModel + fileSize.
// filename/relativePath se guardan pero SOLO añaden confianza, nunca deciden solos.
export async function computeFingerprint({ file, bytes, preview, relativePath }) {
  const buf = bytes || new Uint8Array(await file.arrayBuffer());
  const { captureTime } = readCaptureTimeFromBytes(buf);
  const camera = readCameraMetadataFromBytes(buf);
  const phash = preview?.dataUrl ? await computePHash(preview.dataUrl, preview.decodedSource) : null;
  return {
    fingerprint_hash: phashHex(phash) || "",
    filename: file.name,
    relative_path: relativePath || file.webkitRelativePath || file.name,
    capture_time: captureTime || null,
    camera_make: camera?.make || "",
    camera_model: camera?.model || "",
    file_size: file.size || 0,
  };
}

const PHASH_MATCH_THRESHOLD = 8; // distancia Hamming máxima para considerar coincidencia visual
const TIME_TOLERANCE_MS = 2000;
const MIN_MATCH_SCORE = 60;

function phashDistanceHex(hexA, hexB) {
  try {
    return phashDistance(BigInt("0x" + hexA), BigInt("0x" + hexB));
  } catch {
    return -1;
  }
}

function scoreCandidate(saved, candidate) {
  let score = 0;
  const dHash = saved.fingerprint_hash && candidate.fingerprint_hash
    ? phashDistanceHex(saved.fingerprint_hash, candidate.fingerprint_hash)
    : -1;
  if (dHash >= 0 && dHash <= PHASH_MATCH_THRESHOLD) score += 100 - dHash;
  if (saved.capture_time && candidate.capture_time && Math.abs(saved.capture_time - candidate.capture_time) <= TIME_TOLERANCE_MS) score += 40;
  if (saved.camera_make && saved.camera_make === candidate.camera_make) score += 10;
  if (saved.camera_model && saved.camera_model === candidate.camera_model) score += 10;
  if (saved.file_size && saved.file_size === candidate.file_size) score += 10;
  // Señales secundarias: solo suman confianza.
  if (saved.filename && saved.filename === candidate.filename) score += 5;
  if (saved.relative_path && saved.relative_path === candidate.relative_path) score += 5;
  return score;
}

// Empareja fingerprints guardados (nube) con candidatos recién (re)extraídos de la carpeta.
// Si dos candidatos empatan por encima del umbral, intenta desambiguar por identificador de
// catálogo Lightroom (lr_local_id); si no hay dato o sigue ambiguo, NO empareja
// automáticamente — marca ambiguous=true para revisión manual.
export function matchFingerprints(savedList, candidates) {
  const results = [];
  const used = new Set();

  for (const saved of savedList) {
    const scored = candidates
      .filter((c) => !used.has(c.id))
      .map((c) => ({ candidate: c, score: scoreCandidate(saved, c) }))
      .filter((x) => x.score >= MIN_MATCH_SCORE)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      results.push({ saved, candidate: null, ambiguous: false, matched: false });
      continue;
    }

    const top = scored[0];
    const tie = scored.filter((x) => x.score === top.score);
    if (tie.length > 1) {
      const byCatalog = tie.find(
        (x) => saved.lr_local_id && x.candidate.lr_local_id && saved.lr_local_id === x.candidate.lr_local_id
      );
      if (byCatalog) {
        used.add(byCatalog.candidate.id);
        results.push({ saved, candidate: byCatalog.candidate, ambiguous: false, matched: true });
        continue;
      }
      results.push({ saved, candidate: null, ambiguous: true, matched: false });
      continue;
    }

    used.add(top.candidate.id);
    results.push({ saved, candidate: top.candidate, ambiguous: false, matched: true });
  }

  return results;
}