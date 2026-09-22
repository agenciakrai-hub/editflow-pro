// Hero Shots & Narrative Structure — detecta los clips más potentes (hero shots)
// y asigna transiciones contextuales basadas en la relación entre clips
// consecutivos. Un hero shot recibe tratamiento especial: movimiento "hold"
// (la foto respira sin distracción de cámara), transición dip_to_black, y
// duración extendida si el plan lo permite.
//
// Detectión de hero shot:
//   - Clip en o cerca del clímax musical (±3s)
//   - Intensidad alta (>70)
//   - Es foto de pareja (has_couple o en coupleHashes)
//   - Como mucho 2-3 hero shots por vídeo (no devalúa el concepto)
//
// Transiciones contextuales:
//   - Misma escena consecutiva → cut (ritmo rápido, continuidad)
//   - Escena diferente → cross_dissolve (transición suave)
//   - Hero shot entrante → dip_to_black (momento destacado)
//   - Primer clip del acto → fade (abrir escena)
//   - Último clip → fade (cerrar)

// Marca los hero shots en la timeline (10-25 shots). Respeta los marcados por
// el AI Film Director (backend) y completa hasta el objetivo si faltan.
// Modifica los clips in-place. Devuelve el número total de hero shots.
export function markHeroShots(clips, climaxAt, coupleHashes) {
  if (!clips?.length) return 0;
  const coupleSet = new Set(coupleHashes || []);

  // 1. Respeta los hero shots ya marcados por el AI Film Director (backend).
  const existingHeroes = new Set();
  for (let i = 0; i < clips.length; i++) {
    if (clips[i].is_hero) existingHeroes.add(i);
  }

  // Si ya hay suficientes (≥10), no añade más.
  if (existingHeroes.size >= 10) return existingHeroes.size;

  // 2. Si no hay suficientes, marca adicionales basándose en score.
  const candidates = [];
  for (let i = 0; i < clips.length; i++) {
    if (existingHeroes.has(i)) continue;
    const c = clips[i];
    let score = 0;
    if (climaxAt && c.start <= climaxAt + 3 && c.start + c.duration >= climaxAt - 3) score += 30;
    if (c.intensity >= 70) score += 25;
    else if (c.intensity >= 60) score += 15;
    if (coupleSet.has(c.hash)) score += 20;
    const scene = String(c.scene || "").toLowerCase();
    if (["beso", "pareja", "novia", "novio"].includes(scene)) score += 15;
    if (score > 0) candidates.push({ idx: i, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  // 3. Marca hasta llegar a 10-25 hero shots (según cantidad de clips).
  const targetHeroes = Math.min(25, Math.max(10, Math.floor(clips.length / 5)));
  const toAdd = Math.min(targetHeroes - existingHeroes.size, candidates.length);
  for (let i = 0; i < toAdd; i++) {
    clips[candidates[i].idx].is_hero = true;
    existingHeroes.add(candidates[i].idx);
  }

  return existingHeroes.size;
}

// Asigna transiciones contextuales a los clips. Si el Film Plan ya asignó una
// transición con criterio, la respeta. Solo sobrescribe cuando la transición
// del plan es genérica ("cross_dissolve" por defecto) y hay una mejor opción
// contextual. Modifica los clips in-place.
export function assignContextualTransitions(clips) {
  if (!clips?.length) return;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (i === 0) {
      // Primer clip: fade de apertura (si el plan no especificó otra cosa).
      if (!c.transition || c.transition === "cross_dissolve") {
        c.transition = "fade";
      }
      continue;
    }
    const prev = clips[i - 1];
    // Hero shot entrante → dip_to_black (siempre, sobreescribe).
    if (c.is_hero) {
      c.transition = "dip_to_black";
      continue;
    }
    // Si el plan asignó algo específico (no el default), respétalo.
    if (c.transition && c.transition !== "cross_dissolve" && c.transition !== "fade") {
      continue;
    }
    // Misma escena consecutiva → cut (continuidad, ritmo).
    if (prev.scene === c.scene) {
      c.transition = "cut";
    } else {
      // Escena diferente → cross_dissolve suave.
      c.transition = "cross_dissolve";
    }
  }
  // Último clip: fade de cierre (si no es hero ya).
  const last = clips[clips.length - 1];
  if (last && !last.is_hero && last.transition === "cross_dissolve") {
    last.transition = "fade";
  }
}

// Estructura narrativa: divide la timeline en actos basándose en los cambios
// de escena. Cada acto es un grupo de clips consecutivos de la misma escena o
// escenas relacionadas. Devuelve un array de actos: [{ name, startSec, endSec, clipIndices }].
// Esto se usa para futura funcionalidad (títulos de acto, pausas narrativas).
export function detectActs(clips) {
  if (!clips?.length) return [];
  const acts = [];
  let currentAct = { name: clips[0].scene, startSec: clips[0].start, clipIndices: [0] };

  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    if (c.scene !== currentAct.name) {
      currentAct.endSec = clips[i - 1].start + clips[i - 1].duration;
      acts.push(currentAct);
      currentAct = { name: c.scene, startSec: c.start, clipIndices: [i] };
    } else {
      currentAct.clipIndices.push(i);
    }
  }
  currentAct.endSec = clips[clips.length - 1].start + clips[clips.length - 1].duration;
  acts.push(currentAct);
  return acts;
}