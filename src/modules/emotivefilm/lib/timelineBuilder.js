// Constructor de timeline: toma el Film Plan (escenas + timeline del LLM) y lo
// resuelve en una timeline renderizable con duraciones absolutas, solapamientos
// de transición y alineación a beats. El reproductor y el exportador consumen
// esta timeline normalizada.
import { transitionDuration } from "./transitionEngine";

// Normaliza el film_plan en una timeline con tiempos absolutos.
// Devuelve SIEMPRE { clips, totalDuration } (clips=[] si no hay timeline).
// Cada clip: { hash, scene, motion, transition, intensity, start, duration, transitionDur }
export function buildTimeline(filmPlan, music, settings) {
  const timeline = Array.isArray(filmPlan?.timeline) ? filmPlan.timeline : [];
  if (!timeline.length) return { clips: [], totalDuration: 0 };

  const clips = [];
  let cursor = 0;
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    const dur = Math.max(1.2, Number(t.duration) || 3);
    const transIn = i > 0 ? String(t.transition || "cross_dissolve") : "fade";
    const transDur = i > 0 ? transitionDuration(transIn, settings?.transition_intensity) : 0.8;
    clips.push({
      hash: t.hash,
      scene: t.scene || "otros",
      motion: t.motion || "ken_burns",
      transition: transIn,
      intensity: Number(t.intensity) || 50,
      start: cursor,
      duration: dur,
      transitionDur: transDur,
      subjectPosition: t.subject_position || "center",
    });
    // El siguiente clip empieza solapado con la transición de este.
    cursor += dur - (i < timeline.length - 1 ? transDur : 0);
  }
  const lastDur = timeline.length ? Math.max(1.2, Number(timeline[timeline.length - 1].duration) || 3) : 0;
  const totalDuration = cursor + lastDur;

  // Sincronización con música: alinea los inicios de clip a beats cercanos.
  // Solo ajusta si el beat está dentro de ±0.4s del inicio planificado — no
  // destruye la estructura, solo la "ancla" rítmicamente.
  const beats = music?.beats;
  if (Array.isArray(beats) && beats.length > 4) {
    alignToBeats(clips, beats, totalDuration);
  }

  return { clips, totalDuration };
}

// Alinea los inicios de clip a beats cercanos. Mueve el cursor de cada clip
// al beat más cercano dentro de una ventana de tolerancia. Recalcula los
// tiempos absolutos en cascada para mantener la continuidad.
function alignToBeats(clips, beats, totalDuration) {
  if (!clips.length || !beats.length) return;
  for (let i = 1; i < clips.length; i++) {
    const target = clips[i].start;
    let best = target;
    let bestDist = 0.4; // tolerancia máxima
    for (const b of beats) {
      const d = Math.abs(b - target);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    const delta = best - target;
    if (Math.abs(delta) < 0.05) continue;
    // Desplaza este clip y todos los siguientes.
    for (let j = i; j < clips.length; j++) clips[j].start += delta;
  }
}

// Valida la timeline antes de renderizar. Devuelve { ok, errors[] }.
export function validateTimeline(clips, previewMap) {
  const errors = [];
  if (!clips?.length) {
    errors.push("La timeline está vacía. Genera el Film Plan primero.");
    return { ok: false, errors };
  }
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!c.hash) errors.push(`Clip ${i}: sin hash de foto.`);
    else if (!previewMap?.has(c.hash)) errors.push(`Clip ${i} (${c.hash}): preview no disponible. Importa/procesa la carpeta.`);
    if (c.duration < 0.5) errors.push(`Clip ${i}: duración demasiado corta (${c.duration}s).`);
    if (i > 0 && c.start < clips[i - 1].start) errors.push(`Clip ${i}: empieza antes que el anterior (timeline desordenada).`);
  }
  // Huecos: si un clip empieza más tarde de lo que termina el anterior (sin solapamiento)
  for (let i = 1; i < clips.length; i++) {
    const prevEnd = clips[i - 1].start + clips[i - 1].duration;
    if (clips[i].start > prevEnd + 0.1) {
      errors.push(`Hueco de ${(clips[i].start - prevEnd).toFixed(1)}s entre el clip ${i - 1} y el ${i}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Construcción del clímax: asegura que las fotos más emocionales de la pareja
// estén en el momento de mayor intensidad de la canción. Recibe la timeline
// construida, el momento de clímax (segundos) y los hashes de pareja.
// Si el clip en el clímax no es de pareja, lo intercambia por el clip de pareja
// más cercano al clímax (sin reordenar la timeline, solo sustituyendo el hash).
export function ensureClimaxCouple(clips, climaxAt, coupleHashes) {
  if (!clips.length || !climaxAt || !coupleHashes?.length) return clips;
  const coupleSet = new Set(coupleHashes);
  // Encuentra el clip activo en el clímax.
  let climaxIdx = -1;
  for (let i = 0; i < clips.length; i++) {
    if (clips[i].start <= climaxAt && clips[i].start + clips[i].duration >= climaxAt) {
      climaxIdx = i;
      break;
    }
  }
  if (climaxIdx < 0) climaxIdx = Math.floor(clips.length / 2);
  if (coupleSet.has(clips[climaxIdx].hash)) return clips; // ya es de pareja
  // Busca el clip de pareja MÁS POTENTE (mayor intensidad), no el más cercano.
  // El clímax debe tener la mejor foto de pareja, no una mediocre solo por
  // cercanía temporal. La intensidad del clip refleja la potencia emocional
  // asignada por el Film Director.
  let bestCoupleIdx = -1, bestIntensity = -1;
  for (let i = 0; i < clips.length; i++) {
    if (!coupleSet.has(clips[i].hash)) continue;
    if (clips[i].intensity > bestIntensity) { bestIntensity = clips[i].intensity; bestCoupleIdx = i; }
  }
  if (bestCoupleIdx < 0 || bestCoupleIdx === climaxIdx) return clips;
  // Intercambia los hashes (mantiene tiempos y movimientos).
  const out = clips.map((c) => ({ ...c }));
  const tmpHash = out[climaxIdx].hash;
  const tmpScene = out[climaxIdx].scene;
  out[climaxIdx].hash = out[bestCoupleIdx].hash;
  out[climaxIdx].scene = out[bestCoupleIdx].scene;
  out[bestCoupleIdx].hash = tmpHash;
  out[bestCoupleIdx].scene = tmpScene;
  return out;
}