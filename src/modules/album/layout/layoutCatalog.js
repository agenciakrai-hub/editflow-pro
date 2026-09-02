// LAYOUT LIBRARY — los layouts son DATOS, no componentes (Fase 1 §5).
// Coordenadas como expresiones sobre variables del álbum: W (ancho spread mm), H,
// margin, gutter, bleed, page_w, page_h. Las resuelve layoutEngine → el mismo layout
// sirve para cualquier tamaño de álbum. Añadir layouts futuros = añadir objetos aquí,
// sin tocar el motor ni la UI.
export const LAYOUTS = [
  {
    id: "L001", name: "Foto completa (doble página)", family: "minimal", mode: "spread",
    min_photos: 1, max_photos: 1, orientations: ["landscape", "square", "portrait"],
    slots: [{ slot_id: "s1", role: "hero", x: "0", y: "0", w: "W", h: "H" }],
  },
  {
    id: "L002", name: "Una foto por página", family: "classic", mode: "spread",
    min_photos: 2, max_photos: 2, orientations: ["landscape", "square", "portrait"],
    slots: [
      { slot_id: "s1", role: "hero", x: "margin", y: "margin", w: "page_w-2*margin", h: "page_h-2*margin" },
      { slot_id: "s2", role: "secondary", x: "page_w+gutter+margin", y: "margin", w: "page_w-2*margin", h: "page_h-2*margin" },
    ],
  },
  {
    id: "L003", name: "Dos en horizontal", family: "classic", mode: "spread",
    min_photos: 2, max_photos: 2, orientations: ["landscape", "square"],
    slots: [
      { slot_id: "s1", role: "hero", x: "margin", y: "margin", w: "(W-2*margin-gutter)/2", h: "page_h-2*margin" },
      { slot_id: "s2", role: "secondary", x: "W-margin-(W-2*margin-gutter)/2", y: "margin", w: "(W-2*margin-gutter)/2", h: "page_h-2*margin" },
    ],
  },
  {
    id: "L004", name: "Cuadrícula 2×2", family: "modern", mode: "spread",
    min_photos: 4, max_photos: 4, orientations: ["landscape", "square", "portrait"],
    slots: [
      { slot_id: "s1", x: "margin", y: "margin", w: "(W-2*margin-gutter)/2", h: "(H-2*margin-gutter)/2" },
      { slot_id: "s2", x: "W-margin-(W-2*margin-gutter)/2", y: "margin", w: "(W-2*margin-gutter)/2", h: "(H-2*margin-gutter)/2" },
      { slot_id: "s3", x: "margin", y: "H-margin-(H-2*margin-gutter)/2", w: "(W-2*margin-gutter)/2", h: "(H-2*margin-gutter)/2" },
      { slot_id: "s4", x: "W-margin-(W-2*margin-gutter)/2", y: "H-margin-(H-2*margin-gutter)/2", w: "(W-2*margin-gutter)/2", h: "(H-2*margin-gutter)/2" },
    ],
  },
  {
    id: "L005", name: "Principal + 2", family: "editorial", mode: "spread",
    min_photos: 3, max_photos: 3, orientations: ["landscape", "square", "portrait"],
    slots: [
      { slot_id: "s1", role: "hero", x: "margin", y: "margin", w: "page_w-2*margin", h: "page_h-2*margin" },
      { slot_id: "s2", role: "secondary", x: "page_w+gutter+margin", y: "margin", w: "page_w-2*margin", h: "(H-2*margin-gutter)/2" },
      { slot_id: "s3", role: "secondary", x: "page_w+gutter+margin", y: "H-margin-(H-2*margin-gutter)/2", w: "page_w-2*margin", h: "(H-2*margin-gutter)/2" },
    ],
  },
  {
    id: "L006", name: "Tres verticales", family: "modern", mode: "spread",
    min_photos: 3, max_photos: 3, orientations: ["landscape", "square"],
    slots: [
      { slot_id: "s1", x: "margin", y: "margin", w: "(W-2*margin-2*gutter)/3", h: "page_h-2*margin" },
      { slot_id: "s2", x: "margin+(W-2*margin-2*gutter)/3+gutter", y: "margin", w: "(W-2*margin-2*gutter)/3", h: "page_h-2*margin" },
      { slot_id: "s3", x: "W-margin-(W-2*margin-2*gutter)/3", y: "margin", w: "(W-2*margin-2*gutter)/3", h: "page_h-2*margin" },
    ],
  },
  {
    id: "L007", name: "Página única", family: "minimal", mode: "page_right",
    min_photos: 1, max_photos: 1, orientations: ["landscape", "square", "portrait"],
    slots: [{ slot_id: "s1", role: "hero", x: "margin", y: "margin", w: "page_w-2*margin", h: "page_h-2*margin" }],
  },
];

export function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || null;
}