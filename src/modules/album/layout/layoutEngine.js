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
  return { W, H, margin: album.margin_mm ?? 10, gutter, bleed: album.bleed_mm ?? 3, page_w: (W - gutter) / 2, page_h: H };
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

export function applyLayout(spread, layout, album) {
  const geo = resolveSlots(layout, album);
  const photoIds = (spread.slots || []).map((s) => s.photo_id).filter(Boolean);
  return {
    ...spread,
    layout_id: layout.id,
    slots: geo.map((g, i) => ({
      slot_id: g.slot_id,
      photo_id: photoIds[i] || null,
      x_mm: g.x_mm, y_mm: g.y_mm, w_mm: g.w_mm, h_mm: g.h_mm,
      fit_mode: "fill",
      z_index: i,
      transform: freshTransform(),
    })),
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
    fit_mode: "fill",
    z_index: 100,
    transform: freshTransform(),
  };
}