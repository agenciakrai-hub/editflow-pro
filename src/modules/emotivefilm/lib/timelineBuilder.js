// Constructor de timeline: toma el Film Plan (escenas + timeline del LLM) y lo
// resuelve en una timeline renderizable con duraciones absolutas, solapamientos
// de transición y alineación a beats. El reproductor y el exportador consumen
// esta timeline normalizada.
import { transitionDuration } from "./transitionEngine";
import { markHeroShots, assignContextualTransitions } from "./heroShots";

// Normaliza el film_plan en una timeline con tiempos absolutos.
// Devuelve SIEMPRE { clips, totalDuration } (clips=[] si no hay timeline).
// Cada clip: { hash, scene, motion, transition, intensity, start, duration, transitionDur }
export function buildTimeline(filmPlan, music, settings, heroVideos = {}) {
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
      orientation: t.orientation || "landscape",
      musicIntensity: 0.5, // se rellena tras alinear a beats (si hay música)
      is_hero: !!t.is_hero,
      i2v_prompt: t.i2v_prompt || "",
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

  // Intensidad musical por clip: para cada clip, calcula la intensidad media
  // de la canción durante su duración. El motor cinematográfico usa este valor
  // para modular la amplitud del movimiento (más energía → más zoom/pan).
  if (music?.intensity_curve?.length) {
    assignMusicIntensity(clips, music.intensity_curve, music.duration_sec || totalDuration);
  }

  // Hero Shots: marca los clips más potentes (cerca del clímax, alta intensidad,
  // escena de pareja) como hero shots. Usan el arquetipo "hold" (movimiento
  // mínimo, la foto respira) y transición dip_to_black. Como coupleHashes no está
  // disponible aquí, usamos la escena como proxy (pareja/beso/novia/novio).
  const climaxAt = filmPlan?.climax_at || 0;
  const coupleProxyHashes = clips
    .filter((c) => ["pareja", "beso", "novia", "novio"].includes(String(c.scene).toLowerCase()))
    .map((c) => c.hash);
  markHeroShots(clips, climaxAt, coupleProxyHashes);

  // Transiciones contextuales: asigna transiciones según la relación entre clips
  // consecutivos (misma escena → cut, escena diferente → cross_dissolve, hero →
  // dip_to_black). Solo sobrescribe transiciones genéricas del plan.
  assignContextualTransitions(clips);

  // Recalcula las duraciones de transición tras la asignación contextual
  // (las nuevas transiciones pueden tener duraciones distintas).
  for (let i = 1; i < clips.length; i++) {
    clips[i].transitionDur = transitionDuration(clips[i].transition, settings?.transition_intensity);
  }

  // Asigna videoUrl a los clips hero que tienen un HERO VIDEO completado.
  // Si el hero video está completado, el clip usa el vídeo I2V real; si no
  // (pending/failed/fallback), usa el motor cinematográfico 2D (imagen + Ken Burns).
  for (const c of clips) {
    const hv = heroVideos[c.hash];
    if (c.is_hero && hv?.status === "completed" && hv?.video_url) {
      c.videoUrl = hv.video_url;
    }
  }

  return { clips, totalDuration };
}

// Asigna la intensidad musical media a cada clip muestreando la curva de
// intensidad durante la duración del clip. El motor cinematográfico usa este
// valor (0..1) para modular la amplitud del movimiento de cámara.
function assignMusicIntensity(clips, intensityCurve, musicDuration) {
  if (!intensityCurve?.length || !musicDuration) return;
  for (const c of clips) {
    const startIdx = Math.floor((c.start / musicDuration) * intensityCurve.length);
    const endIdx = Math.min(
      intensityCurve.length - 1,
      Math.floor(((c.start + c.duration) / musicDuration) * intensityCurve.length)
    );
    if (startIdx < 0 || endIdx < startIdx) { c.musicIntensity = 0.5; continue; }
    let sum = 0, count = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      sum += intensityCurve[i] || 0;
      count++;
    }
    c.musicIntensity = count > 0 ? sum / count : 0.5;
  }
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