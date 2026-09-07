// LAYOUT LIBRARY V2 (Fase Lienzos) — las plantillas son DATOS, no componentes.
// Coordenadas como expresiones sobre variables del LIENZO: W, H, margin, gap.
// `gap` es el ESPACIO ENTRE FOTOGRAFÍAS del álbum (photo_gap_mm): las plantillas
// definen SOLO estructura y distribución; el espaciado lo aporta la configuración
// del álbum de forma dinámica (al cambiarlo, layoutEngine recalcula la geometría
// de todos los lienzos con plantilla).
//
// Escalable: añadir plantillas = añadir entradas aquí (o usar las fábricas grid/
// gridIn), sin tocar el motor ni la UI. Los lienzos guardan geometría RESUELTA en
// mm, así que un álbum jamás se rompe aunque una plantilla cambie o desaparezca.

const ALL_ORIENTATIONS = ["landscape", "square", "portrait"];

// Cajas comunes: área útil del lienzo (dentro del margen).
const INNER_W = "W-2*margin";
const INNER_H = "H-2*margin";

function layout(id, name, family, slots) {
  return {
    id, name, family, mode: "spread",
    count: slots.length, min_photos: slots.length, max_photos: slots.length,
    orientations: ALL_ORIENTATIONS,
    slots: slots.map((s, i) => ({ slot_id: `s${i + 1}`, ...s })),
  };
}

// Cuadrícula de cols×rows dentro de una caja expresada con variables del lienzo.
// Genera EXPRESIONES (no geometría resuelta): las resuelve layoutEngine con el gap
// vigente del álbum.
const gridIn = (cols, rows, x0, y0, wBox, hBox) => Array.from({ length: cols * rows }, (_, i) => {
  const cx = i % cols;
  const cy = Math.floor(i / cols);
  const w = `(${wBox}-${cols - 1}*gap)/${cols}`;
  const h = `(${hBox}-${rows - 1}*gap)/${rows}`;
  return {
    x: cx === 0 ? `(${x0})` : `(${x0})+${cx}*(${w}+gap)`,
    y: cy === 0 ? `(${y0})` : `(${y0})+${cy}*(${h}+gap)`,
    w, h,
  };
});

const grid = (id, name, family, cols, rows) =>
  layout(id, name, family, gridIn(cols, rows, "margin", "margin", INNER_W, INNER_H));

export const LAYOUTS = [
  // ---- 1 foto ----
  layout("T01", "Foto a sangre completa", "minimal", [{ x: "0", y: "0", w: "W", h: "H" }]),
  layout("T02", "Foto con margen", "minimal", [{ x: "margin", y: "margin", w: INNER_W, h: INNER_H }]),
  // ---- 2 fotos ----
  grid("T03", "Dos horizontales", "classic", 2, 1),
  grid("T04", "Dos verticales", "classic", 1, 2),
  layout("T05", "Grande + pequeña", "editorial", [
    { x: "margin", y: "margin", w: "(W-2*margin-gap)*0.62", h: INNER_H },
    { x: "margin+(W-2*margin-gap)*0.62+gap", y: "margin", w: "(W-2*margin-gap)*0.38", h: INNER_H },
  ]),
  layout("T06", "Pequeña + grande", "editorial", [
    { x: "margin", y: "margin", w: "(W-2*margin-gap)*0.38", h: INNER_H },
    { x: "margin+(W-2*margin-gap)*0.38+gap", y: "margin", w: "(W-2*margin-gap)*0.62", h: INNER_H },
  ]),
  // ---- 3 fotos ----
  grid("T07", "Tres columnas", "modern", 3, 1),
  grid("T08", "Tres filas", "modern", 1, 3),
  layout("T09", "Grande arriba + 2 abajo", "editorial", [
    { x: "margin", y: "margin", w: INNER_W, h: "(H-2*margin-gap)*0.6" },
    ...gridIn(2, 1, "margin", "margin+(H-2*margin-gap)*0.6+gap", INNER_W, "(H-2*margin-gap)*0.4"),
  ]),
  layout("T10", "Grande izquierda + 2 apiladas", "editorial", [
    { x: "margin", y: "margin", w: "(W-2*margin-gap)*0.62", h: INNER_H },
    ...gridIn(1, 2, "margin+(W-2*margin-gap)*0.62+gap", "margin", "(W-2*margin-gap)*0.38", INNER_H),
  ]),
  layout("T11", "2 apiladas + grande derecha", "editorial", [
    ...gridIn(1, 2, "margin", "margin", "(W-2*margin-gap)*0.38", INNER_H),
    { x: "margin+(W-2*margin-gap)*0.38+gap", y: "margin", w: "(W-2*margin-gap)*0.62", h: INNER_H },
  ]),
  // ---- 4 fotos ----
  grid("T12", "Cuadrícula 2×2", "modern", 2, 2),
  grid("T13", "Cuatro columnas", "modern", 4, 1),
  grid("T14", "Cuatro filas", "modern", 1, 4),
  layout("T15", "Grande arriba + 3 abajo", "editorial", [
    { x: "margin", y: "margin", w: INNER_W, h: "(H-2*margin-gap)*0.6" },
    ...gridIn(3, 1, "margin", "margin+(H-2*margin-gap)*0.6+gap", INNER_W, "(H-2*margin-gap)*0.4"),
  ]),
  // ---- 5 fotos ----
  layout("T16", "Grande izquierda + 2×2", "editorial", [
    { x: "margin", y: "margin", w: "(W-2*margin-gap)*0.55", h: INNER_H },
    ...gridIn(2, 2, "margin+(W-2*margin-gap)*0.55+gap", "margin", "(W-2*margin-gap)*0.45", INNER_H),
  ]),
  layout("T17", "2 arriba + 3 abajo", "modern", [
    ...gridIn(2, 1, "margin", "margin", INNER_W, "(H-2*margin-gap)*0.6"),
    ...gridIn(3, 1, "margin", "margin+(H-2*margin-gap)*0.6+gap", INNER_W, "(H-2*margin-gap)*0.4"),
  ]),
  // ---- 6+ fotos ----
  grid("T18", "Cuadrícula 3×2", "modern", 3, 2),
  grid("T19", "Cuadrícula 2×3", "modern", 2, 3),
  grid("T20", "Tira de 6", "modern", 6, 1),
  grid("T21", "Cuadrícula 4×2", "modern", 4, 2),
  grid("T22", "Cuadrícula 3×3", "modern", 3, 3),
  grid("T23", "Cuadrícula 4×3", "modern", 4, 3),
];

export function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || null;
}