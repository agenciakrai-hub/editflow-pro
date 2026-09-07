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

// Mejora encuadre — AUTO FIT / AUTO COVER: garantiza que la foto cubre SIEMPRE el
// contenedor (escala >= 1 y offsets dentro del límite que el propio zoom permite, sin
// huecos ni deformación, proporción original intacta). freshTransform es el ajuste
// INICIAL al entrar la foto en un hueco; fitTransform RECALCULA el encuadre cuando
// cambia la geometría del contenedor o la plantilla: conserva el encuadre anterior
// siempre que siga siendo geométricamente válido (PRIORIDAD 2) y si no, reclampa
// zoom/posición/crop virtual al mejor encuadre automático (PRIORIDAD 3-4).
export function fitTransform(slot) {
  const t = slot.transform || freshTransform();
  const scale = Math.max(1, Number(t.scale ?? 1) || 1);
  const limX = ((scale - 1) * (slot.w_mm || 0)) / 2;
  const limY = ((scale - 1) * (slot.h_mm || 0)) / 2;
  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, Number(v) || 0));
  // Redondeo a 0.000001 mm: elimina el ruido de coma flotante del cálculo de límites
  // (1.4-1 ≠ 0.4 exacto) sin pérdida práctica de precisión de impresión.
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  return { ...t, scale: r6(scale), offset_x_mm: r6(clamp(t.offset_x_mm, limX)), offset_y_mm: r6(clamp(t.offset_y_mm, limY)) };
}

// Fase Lienzos — aplica una plantilla conservando las fotos por orden. Las fotos que
// no caben NO se eliminan: quedan en el catálogo (se ven con el filtro "Sin colocar").
// El transform (zoom/pan/crop virtual) de cada foto conservada se mantiene siempre
// que es posible (misma posición en la nueva estructura).
export function applyLayout(spread, layout, album) {
  const geo = resolveSlots(layout, album);
  const oldSlots = spread.slots || [];
  const photoIds = oldSlots.map((s) => s.photo_id).filter(Boolean);
  const transformByPhoto = new Map();
  oldSlots.forEach((s) => { if (s.photo_id && s.transform) transformByPhoto.set(s.photo_id, s.transform); });
  return {
    ...spread,
    layout_id: layout.id,
    slots: geo.map((g, i) => {
      const pid = photoIds[i] || null;
      return {
        slot_id: g.slot_id,
        photo_id: pid,
        x_mm: g.x_mm, y_mm: g.y_mm, w_mm: g.w_mm, h_mm: g.h_mm,
        fit_mode: "fill",
        z_index: i,
        // PRIORIDADES del cambio de plantilla: 1) conservar la foto asignada (por orden),
        // 2) conservar su encuadre anterior si es geométricamente válido, 3) si la
        // proporción del hueco cambió, recalcular zoom/posición/crop (auto cover),
        // 4) nunca dejar huecos ni deformar. fitTransform aplica 2→4 en un solo paso.
        transform: pid
          ? fitTransform({ w_mm: g.w_mm, h_mm: g.h_mm, transform: transformByPhoto.get(pid) || freshTransform() })
          : freshTransform(),
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
    fit_mode: "fill",
    z_index: 100,
    transform: freshTransform(),
  };
}