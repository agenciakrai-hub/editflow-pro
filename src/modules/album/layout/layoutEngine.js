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
  // álbum. Las plantillas V2 lo usan como separación DINÁMICA entre huecos: no está
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
export function applyLayout(spread, layout, album) {
  const geo = resolveSlots(layout, album);
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