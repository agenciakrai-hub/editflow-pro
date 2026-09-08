// Fase 4.1 Bloque 9 E3 — agrupación LOCAL de ráfagas: Δt (capture_time) + similitud
// pHash (ambos persistidos en AlbumPhoto desde la Fase 3.1). Sin coste de IA.
const BURST_GAP_MS = 4000; // disparos casi seguidos = misma ráfaga
const SEQUENCE_WINDOW_MS = 15000; // ventana para unir por similitud visual
const PHASH_MAX_DIST = 8; // umbral Hamming estricto (Fase 3.1)
// Tope de tamaño por grupo: al llegar a MAX_GROUP el grupo se cierra aunque la
// siguiente foto siga siendo "parecida". Sin este tope, un reportaje disparado de
// forma continua encadena TODO el catálogo en un único grupo (p. ej. 75 de 79 fotos)
// y el embudo colapsa la selección a una sola foto promovida por grupo.
const MAX_GROUP = 12;

export function phashHexDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function buildGroups(photos) {
  const timed = photos
    .filter((p) => typeof p.capture_time === "number")
    .sort((a, b) => a.capture_time - b.capture_time);
  const untimed = photos.filter((p) => typeof p.capture_time !== "number");
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      groups.push(current);
      current = [];
    }
  };
  for (const p of timed) {
    if (current.length) {
      const prev = current[current.length - 1];
      const dt = p.capture_time - prev.capture_time;
      const dist = phashHexDistance(prev.phash, p.phash);
      const related = dt <= BURST_GAP_MS || (dt <= SEQUENCE_WINDOW_MS && dist <= PHASH_MAX_DIST);
      if (!related || current.length >= MAX_GROUP) flush();
    }
    current.push(p);
  }
  flush();
  const result = groups.map((members, index) => {
    const span = members.length > 1 ? members[members.length - 1].capture_time - members[0].capture_time : 0;
    return {
      group_index: index,
      kind: members.length === 1 ? "single" : span <= BURST_GAP_MS * 2 ? "burst" : "sequence",
      photo_ids: members.map((m) => m.id),
      photos: members,
    };
  });
  untimed.forEach((p) => {
    result.push({ group_index: result.length, kind: "single", photo_ids: [p.id], photos: [p] });
  });
  return result;
}