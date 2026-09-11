// Fase 4.1 Bloque 9 E3 — agrupación de ráfagas por CONTINUIDAD de momento
// fotográfico. El tiempo (Δt) es SOLO una señal de proximidad: NUNCA une fotos
// por sí solo. Una ráfaga = mismo MOMENTO fotográfico: escena + encuadre +
// sujetos continuos, sin cambios significativos de pose / orientación de
// cabeza / expresión / acción.
//
// Señales locales (gratis, sin IA):
//   - pHash (Hamming 64 bits, persistido en AlbumPhoto): identidad de ESCENA.
//   - frameSignal (matriz 16×16 de gris de la preview, ver frameSignal.js):
//     continuidad de ENCUADRE y de SUJETOS — detecta cambios que el pHash
//     (global, 8×8 DCT) no ve: giro de cabeza, pose, expresión, entra/sale.
//
// La IA de visión se usa SOLO para fronteras AMBIGUAS (misma escena + cambio
// moderado que puede ser o no un cambio de momento): se resuelven EN LOTE con
// UNA llamada por cada 12 pares (tope de imágenes del motor). Nunca se envían
// todas las fotos a la IA solo para agrupar.
//
// SIN tope de tamaño por grupo (el antiguo MAX_GROUP=12 partía ráfagas reales):
// el encadenado se controla por CONTINUIDAD — si una foto se aleja demasiado del
// ANCLA (origen) del grupo, la cadena se rompe y nace una ráfaga nueva.
//
// Nunca se modifican ids ni orden temporal: los grupos alimentan E5 igual que antes.
const BURST_GAP_MS = 4000; // ventana de disparo casi seguido (señal, NO autorización)
const SEQUENCE_WINDOW_MS = 15000; // sin proximidad temporal no hay candidata
const PHASH_SAME_FRAME = 8; // misma escena/encuadre
const PHASH_SCENE_MAX = 14; // por encima → escena claramente distinta
const FRAME_TINY = 0.012; // casi idénticas → mismo instante (unión local segura)
const FRAME_NORMAL_MAX = 0.03; // diferencias pequeñas normales entre consecutivas
const FRAME_SCENE_MAX = 0.1; // por encima → escena/encuadre claramente distinto
const ANCHOR_DRIFT_MAX = 0.14; // deriva acumulada respecto al ORIGEN del grupo

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

// Distancia media absoluta entre dos señales 16×16, normalizada 0..1.
export function frameSignalDistance(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

// Decisión de frontera entre dos fotos CONSECUTIVAS en el tiempo.
// "join" = continúa la misma ráfaga (probado localmente, sin IA).
// "break" = nueva ráfaga (escena/encuadre distinto o sin proximidad temporal).
// "ambiguous" = misma escena pero cambio moderado: puede ser un cambio de
//               SUJETO/MOMENTO (giro de cabeza, pose...) o una diferencia normal.
//               Solo estos casos van a visión.
function boundaryDecision(prev, cur, sigOf) {
  const dt = cur.capture_time - prev.capture_time;
  if (dt > SEQUENCE_WINDOW_MS) return "break"; // sin proximidad temporal no hay candidata
  const phash = phashHexDistance(prev.phash, cur.phash);
  const frame = frameSignalDistance(sigOf(prev.id), sigOf(cur.id));
  if (frame == null) {
    // Sin señal visual local (raro: solo fotos sin preview): continuidad por pHash.
    // El tiempo JAMÁS es suficiente por sí solo.
    if (Number.isFinite(phash) && phash <= PHASH_SAME_FRAME) return "join";
    return "break";
  }
  // FASE 5 — cambio claro de escena/encuadre: nueva ráfaga aunque Δt sea mínimo.
  if (phash > PHASH_SCENE_MAX || frame > FRAME_SCENE_MAX) return "break";
  // Mismo instante: casi idénticas (motor-drive) con la misma escena.
  if (frame <= FRAME_TINY && (!Number.isFinite(phash) || phash <= PHASH_SAME_FRAME)) return "join";
  // Diferencias pequeñas normales entre consecutivas (micro-movimientos).
  if (frame <= FRAME_NORMAL_MAX && dt <= BURST_GAP_MS) return "join";
  // FASE 4 — posible cambio de SUJETO/MOMENTO con la misma escena: ambiguo → visión.
  return "ambiguous";
}

export async function buildGroups({ photos, signals, thumbOf, resolveContinuity } = {}) {
  const sigOf = (id) => (signals && typeof signals.get === "function" ? signals.get(id) : null);
  const timed = photos
    .filter((p) => typeof p.capture_time === "number")
    .sort((a, b) => a.capture_time - b.capture_time);
  const untimed = photos.filter((p) => typeof p.capture_time !== "number");

  // PASO 1 — clasificar cada frontera consecutiva (local, gratis).
  const decisions = [];
  const ambiguousPairs = [];
  for (let i = 1; i < timed.length; i++) {
    const d = boundaryDecision(timed[i - 1], timed[i], sigOf);
    if (d === "ambiguous") ambiguousPairs.push({ prev: timed[i - 1], cur: timed[i] });
    decisions.push(d);
  }

  // PASO 2 — resolver SOLO las fronteras ambiguas con visión (lote pequeño).
  let resolved = null;
  if (ambiguousPairs.length && typeof resolveContinuity === "function") {
    try {
      resolved = await resolveContinuity(
        ambiguousPairs.map((p) => ({
          prevId: p.prev.id,
          curId: p.cur.id,
          prevThumb: typeof thumbOf === "function" ? thumbOf(p.prev.id) : null,
          curThumb: typeof thumbOf === "function" ? thumbOf(p.cur.id) : null,
        }))
      );
    } catch {
      resolved = null; // sin visión: unión conservadora (no se parte una ráfaga dudosa)
    }
  }
  const ambiguousDecision = new Map();
  ambiguousPairs.forEach((p, i) => {
    const same = Array.isArray(resolved) && i < resolved.length ? resolved[i] !== false : true;
    ambiguousDecision.set(p.cur.id, same ? "join" : "break");
  });

  // PASO 3 — recorrer en orden temporal cerrando grupos. Control de DERIVA:
  // aunque cada frontera continúe, si la foto se aleja demasiado del ANCLA
  // (origen) del grupo, la continuidad se ha roto → nueva ráfaga. Esto sustituye
  // al tope MAX_GROUP=12 sin partir ráfagas reales.
  const groups = [];
  let current = [];
  let anchor = null;
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    anchor = null;
  };
  for (let i = 0; i < timed.length; i++) {
    const p = timed[i];
    if (i > 0) {
      let d = decisions[i - 1] === "ambiguous" ? ambiguousDecision.get(p.id) || "join" : decisions[i - 1];
      if (d === "join" && anchor) {
        const drift = frameSignalDistance(sigOf(anchor.id), sigOf(p.id));
        if (drift != null && drift > ANCHOR_DRIFT_MAX) d = "break";
      }
      if (d === "break") flush();
    }
    if (!current.length) anchor = p;
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
  // Fotos sin capture_time: NUNCA se mezclan con las temporizadas — cada una es
  // su propio grupo (tratamiento seguro).
  untimed.forEach((p) => {
    result.push({ group_index: result.length, kind: "single", photo_ids: [p.id], photos: [p] });
  });
  return result;
}