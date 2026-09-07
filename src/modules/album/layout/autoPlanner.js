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
import { compatibleLayouts, resolveSlots, photoRatio } from "@/modules/album/layout/layoutEngine";

const CANVAS_COST = 1.2;     // PRIORIDAD 4 — cada lienzo penaliza: prefiere lienzos llenos
const RATIO_W = 1.0;         // PRIORIDAD 3 — distancia logarítmica de proporciones
const ORIENT_ADJACENT = 0.5; // PRIORIDAD 2 — cuadrada↔horizontal / cuadrada↔vertical
const ORIENT_OPPOSITE = 2.0; // PRIORIDAD 2 — horizontal↔vertical (peor caso)

// Orientación derivada del ratio (umbral neutro: >1.15 horizontal, <0.87 vertical).
export function orientationOf(ratio) {
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.87) return "portrait";
  return "square";
}

// Puntúa UNA plantilla contra un grupo de fotos y calcula la asignación
// determinista foto↔hueco (mismo emparejamiento por proporción del motor: verticales
// con verticales, horizontales con horizontales). Devuelve { assignment, cost }.
// assignment alinea cada photo_id con el orden de slots del layout.
function scoreGroup(album, layout, photos) {
  const geo = resolveSlots(layout, album);
  if (geo.length !== photos.length) return null;
  const slots = geo.map((g, i) => ({ i, ratio: g.w_mm / g.h_mm })).sort((a, b) => a.ratio - b.ratio);
  const ph = photos.map((p) => ({ id: p.id, ratio: photoRatio(p) })).sort((a, b) => a.ratio - b.ratio);
  const assignment = new Array(geo.length).fill(null);
  let cost = CANVAS_COST;
  ph.forEach((p, k) => {
    const s = slots[k];
    assignment[s.i] = p.id;
    cost += RATIO_W * Math.abs(Math.log(s.ratio / p.ratio));
    const so = orientationOf(s.ratio);
    const po = orientationOf(p.ratio);
    if (so !== po) cost += (so === "square" || po === "square") ? ORIENT_ADJACENT : ORIENT_OPPOSITE;
  });
  return { assignment, cost };
}

// PLAN DE MAQUETACIÓN para un conjunto ORDENADO de fotos: DP sobre prefijos.
// dp[i] = mejor plan (coste mínimo) para las primeras i fotos. Se maximiza primero
// el número de fotos colocadas y, a igualdad, se minimiza el coste total. El orden
// de las fotos JAMÁS se mezcla: los lienzos consumen bloques consecutivos.
// Las fotos que no entran en ninguna combinación vuelven como `leftover` — el
// llamador las deja SIN COLOCAR (no se pierden, no se marcan como usadas).
export function planAutoLayout(album, photos) {
  const n = photos.length;
  if (!n) return { groups: [], leftover: [] };
  const cap = Number(album.max_photos_per_spread) > 0 ? Number(album.max_photos_per_spread) : 6;
  const usable = compatibleLayouts(album, 0).filter((l) => l.count <= cap);
  if (!usable.length) return { groups: [], leftover: photos };

  const dp = new Array(n + 1).fill(null);
  dp[0] = { cost: 0, groups: [] };
  for (let i = 1; i <= n; i++) {
    for (const l of usable) {
      const k = l.count;
      if (k > i || !dp[i - k]) continue;
      const sc = scoreGroup(album, l, photos.slice(i - k, i));
      if (!sc) continue;
      const cost = dp[i - k].cost + sc.cost;
      if (!dp[i] || cost < dp[i].cost) {
        dp[i] = { cost, groups: [...dp[i - k].groups, { layoutId: l.id, layout: l, assignment: sc.assignment }] };
      }
    }
  }
  let end = n;
  while (end > 0 && !dp[end]) end--;
  const best = dp[end];
  return { groups: best.groups, leftover: photos.slice(end) };
}