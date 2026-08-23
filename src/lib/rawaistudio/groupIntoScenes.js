// RAW AI Studio — agrupación en ESCENAS (ráfagas reales). Combina el TIEMPO REAL de
// captura (EXIF DateTimeOriginal, ver captureTime.js) con la SIMILITUD VISUAL (pHash):
// dos fotos van al mismo grupo solo si están cerca en el tiempo Y son visualmente
// parecidas. Así "IMG_001..005" de la misma escena forman una secuencia, pero dos
// tomas de escenas distintas tomadas con pocos segundos de diferencia NO se funden.
//
// Fallback honrado cuando no hay EXIF: nº de secuencia del nombre + file.lastModified.
// Solo lectura: nunca reordena ni modifica los RAW originales.

function extractSeqNumber(name) {
  const m = name.match(/(\d+)(?=\.[a-zA-Z0-9]+$)/);
  return m ? parseInt(m[0], 10) : null;
}

function timeOf(item) {
  return item.captureTime ?? item.file?.lastModified ?? 0;
}

import { phashDistance } from "./perceptualHash";

export function groupIntoScenes(items, { gapMs = 3000, phashThreshold = 12, maxBurstSize = 30 } = {}) {
  const sorted = [...items].sort((a, b) => {
    const ta = timeOf(a), tb = timeOf(b);
    if (ta !== tb) return ta - tb;
    const sa = extractSeqNumber(a.file?.name ?? "") ?? 0;
    const sb = extractSeqNumber(b.file?.name ?? "") ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.file?.name ?? "").localeCompare(b.file?.name ?? "");
  });

  const groups = [];
  let current = null;

  const sameScene = (item, group) => {
    const dt = Math.abs(timeOf(item) - group.lastTime);
    if (dt > gapMs) return false;
    const d = phashDistance(item.phash, group.lastPhash);
    // Sin pHash disponible → solo criterio temporal (conservador, no fusiona por视觉).
    if (d === -1) return true;
    return d <= phashThreshold;
  };

  for (const item of sorted) {
    const sizeOk = current && current.files.length < maxBurstSize;
    if (current && sizeOk && sameScene(item, current)) {
      current.files.push(item);
      current.lastTime = timeOf(item);
      current.lastPhash = item.phash ?? current.lastPhash;
    } else {
      current = {
        id: `scene-${groups.length}`,
        files: [item],
        lastTime: timeOf(item),
        lastPhash: item.phash ?? null,
      };
      groups.push(current);
    }
  }
  return groups;
}