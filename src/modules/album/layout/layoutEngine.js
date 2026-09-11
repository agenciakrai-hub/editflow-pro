// LayoutEngine — motor ÚNICO y genérico (Fase 1 §5.3): valida layouts, resuelve sus
// expresiones a mm concretos y los aplica a un spread conservando las fotos por orden.
// No conoce React ni IA: pura geometría + datos. Los spreads guardan la geometría
// RESUELTA → un álbum nunca se rompe aunque un layout desaparezca del catálogo.
import { getLayout, LAYOUTS } from "@/modules/album/layout/layoutCatalog";
import { deriveOrientation } from "@/modules/album/lib/albumUnits";

export function albumVars(album) {
  const W = Number(album.width_mm);
  const H = Number(album.height_mm);
  const gutter = album.gutter_mm ?? 6;
  // Fase Lienzos — `gap` = espacio entre fotografías (photo_gap_mm) configurado en el
  // álbum. Las plantillas lo usan como separación DINÁMICA entre huecos: no está
  // fijado en el catálogo, y al cambiarlo la geometría se recalcula.
  return { W, H, margin: album.margin_mm ?? 10, gutter, bleed: album.bleed_mm ?? 3, gap: album.photo_gap_mm ?? 0, page_w: (W - gutter) / 2, page_h: H };
}

// Mini-evaluador de expresiones (+ - * / paréntesis) sobre variables del álbum.
export function evalExpr(src, vars) {
  const tokens = String(src).replace(/\s+/g, "").match(/[-+*/()]|[A-Za-z_][A-Za-z0-9_]*|\d*\.?\d+/g);
  if (!tokens) throw new Error("Expresión vacía");
  let i = 0;
  const peek = () => tokens[i];
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++];
      const r = parseFactor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    const t = tokens[i];
    if (t === "(") { i++; const v = parseExpr(); if (tokens[i] !== ")") throw new Error("Paréntesis sin cerrar"); i++; return v; }
    if (t === "-") { i++; return -parseFactor(); }
    i++;
    if (/^[A-Za-z_]/.test(t)) {
      const v = vars[t];
      if (typeof v !== "number" || !isFinite(v)) throw new Error("Variable desconocida: " + t);
      return v;
    }
    const n = Number(t);
    if (!isFinite(n)) throw new Error("Número inválido: " + t);
    return n;
  }
  const out = parseExpr();
  if (i !== tokens.length) throw new Error("Expresión inválida: " + src);
  return out;
}

export function resolveSlots(layout, album) {
  const v = albumVars(album);
  return layout.slots.map((s, idx) => ({
    slot_id: s.slot_id || `s${idx + 1}`,
    role: s.role || null,
    x_mm: evalExpr(s.x, v),
    y_mm: evalExpr(s.y, v),
    w_mm: evalExpr(s.w, v),
    h_mm: evalExpr(s.h, v),
  }));
}

export function compatibleLayouts(album, photoCount) {
  const o = deriveOrientation(album.width_mm, album.height_mm);
  return LAYOUTS.filter(
    (l) => l.orientations.includes(o) && (photoCount === 0 || (photoCount >= l.min_photos && photoCount <= l.max_photos))
  );
}

export const freshTransform = () => ({ scale: 1, offset_x_mm: 0, offset_y_mm: 0, rotation: 0, crop: null });

// Corrección recorte — misma proporción de contenedor (tolerancia 1 % logarítmica).
// Si el hueco nuevo conserva la proporción del antiguo, el encuadre manual del
// fotógrafo sigue siendo válido y se conserva tal cual.
export function sameRatio(w1, h1, w2, h2) {
  if (!(w1 > 0) || !(h1 > 0) || !(w2 > 0) || !(h2 > 0)) return false;
  return Math.abs(Math.log((w1 / h1) / (w2 / h2))) < 0.01;
}

// Ratio de aspecto (ancho/alto) de una foto: dimensiones reales si existen y, si no,
// la orientación registrada. Base de la plantilla automática determinista.
export function photoRatio(photo) {
  if (photo?.width_px > 0 && photo?.height_px > 0) return photo.width_px / photo.height_px;
  if (photo?.orientation === "portrait") return 2 / 3;
  if (photo?.orientation === "square") return 1;
  return 3 / 2;
}

// Orientación derivada del ratio (umbral neutro: >1.15 horizontal, <0.87 vertical).
// Helper de geometría neutro: lo usan el planificador (Fase 1) y el perfil visual
// (Fase 2) sin crear dependencias cíclicas entre módulos.
export function orientationOf(ratio) {
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.87) return "portrait";
  return "square";
}

// Colocación múltiple — SELECCIÓN INTELIGENTE determinista (sin IA): entre las
// plantillas compatibles con el número de fotos, elige la de menor penalización
// |log(ratio_hueco / ratio_foto)| emparejando fotos y huecos por proporción
// (verticales con verticales, horizontales con horizontales), con recargo por huecos
// vacíos. Devuelve { layout, assignment, penalty } — assignment alinea cada photo_id
// con el orden de slots del layout (null = hueco vacío) — o null si no hay plantilla
// compatible.
export function bestLayoutFor(album, photos) {
  const n = photos.length;
  const candidates = compatibleLayouts(album, n);
  let best = null;
  for (const l of candidates) {
    const geo = resolveSlots(l, album);
    // Plantillas con menos huecos que fotos: no caben todas, se descartan.
    if (geo.length < n) continue;
    const slots = geo.map((g, i) => ({ i, ratio: g.w_mm / g.h_mm })).sort((a, b) => a.ratio - b.ratio);
    const ph = photos.map((p) => ({ id: p.id, ratio: photoRatio(p) })).sort((a, b) => a.ratio - b.ratio);
    const assignment = new Array(geo.length).fill(null);
    let penalty = 0.4 * (geo.length - n);
    ph.forEach((p, k) => {
      const s = slots[k];
      assignment[s.i] = p.id;
      penalty += Math.abs(Math.log(s.ratio / p.ratio));
    });
    if (!best || penalty < best.penalty) best = { layout: l, assignment, penalty };
  }
  return best;
}

// Fase Lienzos — aplica una plantilla conservando las fotos por orden. Las fotos que
// no caben NO se eliminan: quedan en el catálogo (se ven con el filtro "Sin colocar").
// Corrección recorte: el ajuste AUTOMÁTICO inicial es FIT/CONTAIN — la foto se ve
// COMPLETA, sin recortes, con su proporción original y centrada. El encuadre manual
// del fotógrafo se conserva SOLO si el nuevo hueco mantiene la proporción del antiguo.
// Fase 1 §4 — separación entre fotografías POR LIENZO (override opcional): si el
// spread lleva photo_gap_mm propio se usa para resolver SU geometría; si es
// null/undefined se usa la global del álbum (comportamiento existente). Nunca
// afecta a otros lienzos ni a la configuración global.
export function albumFor(album, spread) {
  const g = spread?.photo_gap_mm;
  return g == null ? album : { ...album, photo_gap_mm: g };
}

export function applyLayout(spread, layout, album) {
  const geo = resolveSlots(layout, albumFor(album, spread));
  const oldSlots = spread.slots || [];
  const photoIds = oldSlots.map((s) => s.photo_id).filter(Boolean);
  const oldByPhoto = new Map();
  oldSlots.forEach((s) => { if (s.photo_id) oldByPhoto.set(s.photo_id, s); });
  return {
    ...spread,
    layout_id: layout.id,
    slots: geo.map((g, i) => {
      const pid = photoIds[i] || null;
      const old = pid ? oldByPhoto.get(pid) : null;
      // PRIORIDADES: 1) conservar la foto asignada (por orden). 2) conservar su
      // encuadre manual solo si el nuevo hueco tiene la misma proporción. 3) si la
      // proporción cambió, recolocar en FIT/CONTAIN automático (recalcula escala y
      // posición iniciales; foto completa, sin recorte, sin deformación). 4) nunca
      // eliminar fotos ni perder transformaciones innecesariamente.
      const keep = old && sameRatio(old.w_mm, old.h_mm, g.w_mm, g.h_mm);
      return {
        slot_id: g.slot_id,
        photo_id: pid,
        x_mm: g.x_mm, y_mm: g.y_mm, w_mm: g.w_mm, h_mm: g.h_mm,
        fit_mode: keep ? (old.fit_mode || "fit") : "fit",
        z_index: i,
        transform: keep && old.transform ? old.transform : freshTransform(),
      };
    }),
  };
}

// Hueco libre colocado en el centro del spread (modo custom: soltar foto en el lienzo).
export function makeCustomSlot(album, photoId) {
  const v = albumVars(album);
  const w = Math.round(v.page_w * 0.7);
  const h = Math.round(v.page_h * 0.7);
  return {
    slot_id: "c_" + Math.random().toString(36).slice(2, 8),
    photo_id: photoId || null,
    x_mm: Math.round((v.W - w) / 2),
    y_mm: Math.round((v.H - h) / 2),
    w_mm: w,
    h_mm: h,
    fit_mode: "fit",
    z_index: 100,
    transform: freshTransform(),
  };
}

// ---- Relleno completo del lienzo (POR LIENZO, Fase Relleno plantilla) ----
// Expansión 1D por segmentos: los tramos OCUPADOS por huecos crecen
// proporcionalmente hasta llenar la región [r0, r1]; los tramos LIBRES interiores
// (separación entre fotos y huecos estructurales de la plantilla) conservan su
// longitud EXACTA; los márgenes exteriores desaparecen. El mapeo es monótono → los
// huecos nunca se solapan ni se cruzan, y es idempotente (expandir dos veces da el
// mismo resultado: no hay error acumulativo).
function axisExpandMapper(items, r0, r1) {
  const eps = 1e-6;
  const bounds = Array.from(new Set(items.flatMap((it) => [it.p, it.p + it.s])))
    .filter((v) => v >= r0 - eps && v <= r1 + eps)
    .sort((a, b) => a - b);
  if (bounds.length < 2) return (p) => Math.min(Math.max(p, r0), r1);
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    segs.push({ a, b, len: b - a, covered: items.some((it) => it.p <= a + eps && it.p + it.s >= b - eps) });
  }
  const interiorFree = segs.filter((g) => !g.covered).reduce((t, g) => t + g.len, 0);
  const coveredLen = segs.filter((g) => g.covered).reduce((t, g) => t + g.len, 0);
  const avail = r1 - r0 - interiorFree;
  if (coveredLen <= eps || avail <= eps) return (p) => Math.min(Math.max(p, r0), r1);
  const scale = avail / coveredLen;
  const map = new Map();
  let cur = r0;
  for (const g of segs) {
    map.set(g.a, cur);
    cur += g.covered ? g.len * scale : g.len;
    map.set(g.b, cur);
  }
  return (p) => {
    const v = map.get(p);
    return v == null ? Math.min(Math.max(p, r0), r1) : Math.min(Math.max(v, r0), r1);
  };
}

// Relleno completo del lienzo — expande la GEOMETRÍA de los huecos para que la
// plantilla ocupe TODO el lienzo (o solo SU página en los modos page_left /
// page_right: nunca invade la otra página), manteniendo EXACTOS los espacios
// interiores. Puro: devuelve slots NUEVOS con la misma identidad (photo_id,
// fit_mode y transform intactos; solo cambian x/y/w/h). El reajuste de cada foto lo
// decide quien llama, con las reglas existentes de proporción.
export function expandSlotsToCanvas(album, mode, slots) {
  const list = (slots || []).filter((sl) => sl.w_mm > 0 && sl.h_mm > 0);
  if (!list.length) return slots || [];
  const v = albumVars(album);
  const rx0 = mode === "page_right" ? v.W - v.page_w : 0;
  const rx1 = mode === "page_left" ? v.page_w : v.W;
  const mapX = axisExpandMapper(list.map((sl) => ({ p: sl.x_mm, s: sl.w_mm })), rx0, rx1);
  const mapY = axisExpandMapper(list.map((sl) => ({ p: sl.y_mm, s: sl.h_mm })), 0, v.H);
  const r2 = (n) => Math.round(n * 100) / 100;
  return (slots || []).map((sl) => {
    const nx = mapX(sl.x_mm);
    const nxr = mapX(sl.x_mm + sl.w_mm);
    const ny = mapY(sl.y_mm);
    const nyb = mapY(sl.y_mm + sl.h_mm);
    return { ...sl, x_mm: r2(nx), y_mm: r2(ny), w_mm: r2(nxr - nx), h_mm: r2(nyb - ny) };
  });
}