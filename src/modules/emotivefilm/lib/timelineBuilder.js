// Constructor de timeline: toma el Film Plan (escenas + timeline del LLM) y lo
// resuelve en una timeline renderizable con duraciones absolutas, solapamientos
// de transición y alineación a beats. El reproductor y el exportador consumen
// esta timeline normalizada.
import { transitionDuration } from "./transitionEngine";

// Normaliza el film_plan en una timeline con tiempos absolutos.
// Cada clip: { hash, filename, scene, motion, transition, intensity, start, duration, transitionIn, transitionDur }
export function buildTimeline(filmPlan, music, settings) {
  const timeline = Array.isArray(filmPlan?.timeline) ? filmPlan.timeline : [];
  if (!timeline.length) return [];

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
    });
    // El siguiente clip empieza solapado con la transición de este.
    cursor += dur - (i < timeline.length - 1 ? transDur : 0);
  }
  return { clips, totalDuration: cursor + (timeline.length ? timeline[timeline.length - 1].duration || 3 : 0) };
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