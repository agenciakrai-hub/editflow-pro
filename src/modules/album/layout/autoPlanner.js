// Fase 1 — MAQUETACIÓN AUTOMÁTICA DETERMINISTA (sin IA). Planificador PURO: recibe
// fotos ORDENADAS y el álbum, y calcula el PLAN de maquetación completo (lienzos,
// plantillas y asignación foto↔hueco) evaluando el conjunto con programación
// dinámica sobre prefijos — NO greedy: prueba todas las combinaciones de plantillas
// del catálogo y elige la de mejor puntuación total.
//
// REUTILIZA el catálogo y el motor existentes (compatibleLayouts / resolveSlots /
// photoRatio): no duplica ningún sistema, no modifica plantillas y no conoce React.
// La "capa de análisis" de plantillas (nº de contenedores, ratio y orientación de
// cada hueco) se DERIVA resolviendo la geometría con el álbum real — nunca se
// almacena en el catálogo.
//
// PRIORIDADES DE PUNTUACIÓN (deterministas, ampliables en Fase 2 con IA):
//   1. NÚMERO DE FOTOS — solo plantillas con EXACTAMENTE k huecos para k fotos: sin
//      huecos vacíos. Lo que no encaja queda `leftover` (sin colocar, nunca se pierde).
//   2. ORIENTACIÓN — vertical→hueco vertical, horizontal→hueco horizontal; una foto
//      vertical en hueco horizontal penaliza al máximo; el cuadrado es vecino neutro.
//   3. RATIO — |log(ratio_hueco / ratio_foto)|: la proporción más cercana gana.
//   4. APROVECHAMIENTO — coste fijo por lienzo creado: menos lienzos y más llenos.
import { compatibleLayouts, resolveSlots, photoRatio, orientationOf } from "@/modules/album/layout/layoutEngine";
import { slotSizeClass, faceCropRisk, sizeRank } from "@/modules/album/layout/visualProfile";

// Re-exportado por compatibilidad (otros módulos lo importaban desde aquí).
export { orientationOf } from "@/modules/album/layout/layoutEngine";

const CANVAS_COST = 1.2;     // PRIORIDAD 4 — cada lienzo penaliza: prefiere lienzos llenos
const RATIO_W = 1.0;         // PRIORIDAD 3 — distancia logarítmica de proporciones
const ORIENT_ADJACENT = 0.5; // PRIORIDAD 2 — cuadrada↔horizontal / cuadrada↔vertical
const ORIENT_OPPOSITE = 2.0; // PRIORIDAD 2 — horizontal↔vertical (peor caso)

// ---- Fase 2 — PESOS VISUALES IA (siempre menores que los deterministas) ----
// A. Tamaño del contenedor: foto importante → hueco grande.
// B. Caras: penaliza combinaciones con riesgo de recorte problemático.
// C. Compatibilidad: bonificación leve cuando la orientación preferida coincide.
// D. Coherencia del grupo: un "héroe" claro en un layout con hueco grande.
const SIZE_W = 0.20;
const FACE_W = 0.15;
const COMP_W = 0.08;
const HERO_BONUS = 0.08;

// ---- SIMILITUD entre fotos (grupos de ráfaga/secuencia del pipeline de
// Selección IA): penaliza repetir fotos casi idénticas en el mismo lienzo y, en
// el planificador, también en lienzos CONSECUTIVOS (cuando es posible evitarlo). ----
const SIM_SAME_W = 1.4; // Punto 2 — refuerzo: fotos casi idénticas en el mismo lienzo
const SIM_CONSEC_W = 0.8; // Punto 2 — refuerzo: repetir grupo en lienzos consecutivos
// CALIDAD (punto 6) — penaliza colocar una foto cuya resolución nativa no alcanza
// los ppp mínimos de impresión en su hueco (base cover): la DP prefiere otra
// plantilla o asignación donde la foto entre con calidad.
const QUALITY_W = 0.6;
const DPI_MIN = 150;

// Puntúa UNA plantilla contra un grupo de fotos y calcula la asignación
// determinista foto↔hueco (mismo emparejamiento por proporción del motor: verticales
// con verticales, horizontales con horizontales). Devuelve { assignment, cost }.
// assignment alinea cada photo_id con el orden de slots del layout.
function scoreGroup(album, layout, photos, profiles, simGroups, costs) {
  const geo = resolveSlots(layout, album);
  if (geo.length !== photos.length) return null;
  const maxArea = geo.reduce((m, g) => Math.max(m, g.w_mm * g.h_mm), 0);
  const slots = geo.map((g, i) => ({ i, ratio: g.w_mm / g.h_mm, sizeClass: slotSizeClass(g, maxArea) })).sort((a, b) => a.ratio - b.ratio);
  const ph = photos.map((p) => ({ id: p.id, ratio: photoRatio(p) })).sort((a, b) => a.ratio - b.ratio);
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const assignment = new Array(geo.length).fill(null);
  let cost = costs?.canvas ?? CANVAS_COST;
  let visual = 0;
  // SIMILITUD — grupos de ráfaga/secuencia presentes en ESTE bloque de fotos.
  const simIds = new Set();
  ph.forEach((p, k) => {
    const s = slots[k];
    assignment[s.i] = p.id;
    cost += RATIO_W * Math.abs(Math.log(s.ratio / p.ratio));
    const so = orientationOf(s.ratio);
    const po = orientationOf(p.ratio);
    if (so !== po) cost += (so === "square" || po === "square") ? ORIENT_ADJACENT : ORIENT_OPPOSITE;
    // CALIDAD (punto 6) — DPI efectivo de la foto en su hueco (base cover).
    const qphoto = photoById.get(p.id);
    if (qphoto?.width_px > 0 && qphoto?.height_px > 0) {
      const sw = geo[s.i].w_mm;
      const sh = geo[s.i].h_mm;
      if (sw > 0 && sh > 0) {
        const qr = qphoto.width_px / qphoto.height_px;
        const dw = Math.max(sw, sh * qr);
        const dh = Math.max(sh, sw / qr);
        const dpi = Math.min((25.4 * qphoto.width_px) / dw, (25.4 * qphoto.height_px) / dh);
        if (dpi < DPI_MIN) visual += QUALITY_W * ((DPI_MIN - dpi) / DPI_MIN);
      }
    }
    // SIMILITUD — penaliza fotos casi idénticas dentro del MISMO lienzo.
    const gid = simGroups?.get(p.id);
    if (gid != null) {
      if (simIds.has(gid)) cost += SIM_SAME_W;
      simIds.add(gid);
    }
    // ---- Fase 2 — VISUAL AI SCORE (pesos pequeños: nunca superan al determinista) ----
    const prof = profiles?.get(p.id);
    if (prof) {
      // A. Tamaño del contenedor: foto importante → hueco grande.
      visual += SIZE_W * Math.abs((sizeRank[prof.preferredSlot.size] ?? 1) - (sizeRank[s.sizeClass] ?? 1));
      // B. Caras: penaliza combinaciones con riesgo de recorte problemático.
      visual += FACE_W * faceCropRisk(prof, s.ratio, p.ratio, s.sizeClass);
      // C. Compatibilidad: bonificación leve cuando la orientación preferida coincide.
      if (prof.preferredSlot.orientation && prof.preferredSlot.orientation === so) visual -= COMP_W * 0.5;
    }
  });
  // D. Combinación entre fotos: un "héroe" claro en un layout con hueco grande (sin
  //    alterar el orden: el planificador ya consume bloques consecutivos).
  if (profiles?.size) {
    const imps = photos.map((p) => profiles.get(p.id)?.visualImportance ?? 0).sort((a, b) => b - a);
    if (imps.length >= 2 && imps[0] >= 60 && imps[0] - imps[1] >= 25 && slots.some((s) => s.sizeClass === "large")) {
      visual -= HERO_BONUS;
    }
  }
  return { assignment, cost: cost + visual, sim: simIds };
}

// PLAN DE MAQUETACIÓN para un conjunto ORDENADO de fotos: DP sobre prefijos con
// dimensión de nº de lienzos. dp[i][c] = mejor plan (coste mínimo) para las
// primeras i fotos usando EXACTAMENTE c lienzos.
//   · MÁXIMO DE LIENZOS (opts.maxSpreads, configurable antes de ejecutar): el
//     plan JAMÁS crea más lienzos que el límite; busca la mejor combinación de
//     plantillas y fotos por lienzo dentro de él.
//   · SIMILITUD (opts.simGroups: Map<photoId, grupo de ráfaga/secuencia>): penaliza
//     fotos casi idénticas en el mismo lienzo (scoreGroup) y en lienzos
//     consecutivos (estado del bloque anterior de la DP).
// Se maximiza primero el número de fotos colocadas y, a igualdad, se minimiza el
// coste total. El orden de las fotos JAMÁS se mezcla: los lienzos consumen bloques
// consecutivos. Las fotos que no entran vuelven como `leftover` (sin colocar,
// nunca se pierden).
export function planAutoLayout(album, photos, profiles, opts = {}) {
  const n = photos.length;
  if (!n) return { groups: [], leftover: [] };
  const cap = Number(opts?.maxPerSpread) > 0 ? Number(opts.maxPerSpread) : (Number(album.max_photos_per_spread) > 0 ? Number(album.max_photos_per_spread) : 6);
  const usable = compatibleLayouts(album, 0).filter((l) => l.count <= cap);
  if (!usable.length) return { groups: [], leftover: photos };
  // PRIORIDAD de reparto (decisión del usuario antes de generar, punto 14): ajusta
  // el coste por lienzo para que la DP prefiera lienzos más llenos (más fotos por
  // lienzo) o más livianos (más espacio por foto). Equilibrado = coste base. Los
  // pesos visuales IA siempre son menores que los deterministas, así que esta
  // prioridad no altera la cobertura ni el límite de lienzos.
  const priority = opts?.priority || "balanced";
  const costs = { canvas: priority === "morePhotos" ? CANVAS_COST * 1.6 : priority === "moreSpace" ? CANVAS_COST * 0.5 : CANVAS_COST };

  const simGroups = opts?.simGroups || null;
  // Límite de lienzos: el indicado por el usuario o el máximo geométrico posible.
  const minCount = Math.max(1, Math.min(...usable.map((l) => l.count)));
  const geoMax = Math.ceil(n / minCount);
  const limit = Number(opts?.maxSpreads);
  const maxCanvases = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), geoMax) : geoMax;

  const dp = Array.from({ length: n + 1 }, () => new Array(maxCanvases + 1).fill(null));
  dp[0][0] = { cost: 0, groups: [], lastSim: [] };
  for (let i = 1; i <= n; i++) {
    for (const l of usable) {
      const k = l.count;
      if (k > i) continue;
      // El scoring del bloque se calcula UNA vez y se reutiliza para todos los
      // conteos de lienzos c.
      const sc = scoreGroup(album, l, photos.slice(i - k, i), profiles, simGroups, costs);
      if (!sc) continue;
      const group = { layoutId: l.id, layout: l, assignment: sc.assignment };
      for (let c = 1; c <= maxCanvases; c++) {
        const prev = dp[i - k][c - 1];
        if (!prev) continue;
        // SIMILITUD — lienzos consecutivos: repetir un grupo del lienzo anterior
        // penaliza (el mismo lienzo ya se penaliza dentro de scoreGroup).
        const consec = sc.sim.size && prev.lastSim.length ? [...sc.sim].filter((x) => prev.lastSim.includes(x)).length : 0;
        const cost = prev.cost + sc.cost + SIM_CONSEC_W * consec;
        const cur = dp[i][c];
        if (!cur || cost < cur.cost) {
          dp[i][c] = { cost, groups: [...prev.groups, group], lastSim: [...sc.sim] };
        }
      }
    }
  }
  // Mejor plan global: primero MÁS fotos colocadas dentro del límite, luego MENOR coste.
  for (let end = n; end > 0; end--) {
    let best = null;
    for (let c = 1; c <= maxCanvases; c++) {
      const cand = dp[end][c];
      if (cand && (!best || cand.cost < best.cost)) best = cand;
    }
    if (best) return { groups: best.groups, leftover: photos.slice(end) };
  }
  return { groups: [], leftover: photos };
}