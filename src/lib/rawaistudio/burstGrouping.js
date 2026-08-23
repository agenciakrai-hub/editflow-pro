// RAW AI Studio — agrupación de ráfagas. Combina la fecha de modificación del archivo
// (aproxima la fecha de captura) con la numeración de secuencia del nombre cuando existe,
// y limita el tamaño máximo de un grupo para no fusionar por error toda una carpeta en una
// sola ráfaga. Solo lectura: nunca reordena ni modifica los RAW originales en disco.

function extractSeqNumber(name) {
  const m = name.match(/(\d+)(?=\.[a-zA-Z0-9]+$)/);
  return m ? parseInt(m[0], 10) : null;
}

export function groupIntoBursts(items, { gapMs = 2000, maxBurstSize = 20 } = {}) {
  const sorted = [...items].sort(
    (a, b) => (a.file.lastModified - b.file.lastModified) || a.file.name.localeCompare(b.file.name)
  );
  const bursts = [];
  let current = null;
  let prevSeq = null;

  for (const item of sorted) {
    const seq = extractSeqNumber(item.file.name);
    const timeClose = current && item.file.lastModified - current.lastTime <= gapMs;
    const seqClose = seq == null || prevSeq == null || Math.abs(seq - prevSeq) <= 2;
    const sizeOk = current && current.files.length < maxBurstSize;

    if (current && timeClose && seqClose && sizeOk) {
      current.files.push(item);
      current.lastTime = item.file.lastModified;
    } else {
      current = { id: `burst-${bursts.length}`, files: [item], lastTime: item.file.lastModified };
      bursts.push(current);
    }
    prevSeq = seq;
  }
  return bursts;
}