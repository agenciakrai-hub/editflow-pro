// Unidades y dimensiones de álbum — Fase 1 §3. TODO el cálculo y almacenamiento es en
// mm (canónico). La orientación SIEMPRE se deriva de las dimensiones, nunca se guarda.
export const SIZE_PRESETS = [
  { id: "30x30", label: "30 × 30 cm", w: 300, h: 300 },
  { id: "25x35", label: "25 × 35 cm (vertical)", w: 250, h: 350 },
  { id: "35x25", label: "35 × 25 cm (horizontal)", w: 350, h: 250 },
  { id: "40x30", label: "40 × 30 cm (horizontal)", w: 400, h: 300 },
  { id: "30x40", label: "30 × 40 cm (vertical)", w: 300, h: 400 },
  { id: "20x20", label: "20 × 20 cm", w: 200, h: 200 },
  { id: "20x30", label: "20 × 30 cm (vertical)", w: 200, h: 300 },
];

export const DEFAULT_ALBUM = {
  event_type: "other",
  dpi: 300,
  bleed_mm: 3,
  margin_mm: 10,
  gutter_mm: 6,
  spread_count_target: 20,
  max_photos_per_spread: 6,
  style_hint: "minimal",
  display_unit: "cm",
};

export function deriveOrientation(w, h) {
  if (Math.abs(Number(w) - Number(h)) < 1) return "square";
  return Number(w) > Number(h) ? "landscape" : "portrait";
}

export const ORIENTATION_LABEL = { landscape: "Horizontal", portrait: "Vertical", square: "Cuadrado" };

export function unitToMm(value, unit) {
  return unit === "cm" ? Number(value) * 10 : Number(value);
}

export function mmToUnit(mm, unit) {
  return unit === "cm" ? Number(Number(mm) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.round(Number(mm)));
}

export function mmToPx(mm, dpi = 300) {
  return (Number(mm) * dpi) / 25.4;
}

export function validateDimensions(w, h) {
  return Number(w) >= 100 && Number(w) <= 500 && Number(h) >= 100 && Number(h) <= 500;
}

export function albumSizeLabel(album) {
  const u = album.display_unit || "cm";
  return `${mmToUnit(album.width_mm, u)} × ${mmToUnit(album.height_mm, u)} ${u}`;
}

export const STATUS_LABEL = {
  draft: "Borrador",
  imported: "Fotos importadas",
  designing: "En diseño",
  reviewed: "Revisado",
  final: "Final",
};

export const EVENT_LABEL = {
  wedding: "Boda",
  communion: "Comunión",
  baptism: "Bautizo",
  family: "Familiar",
  event: "Evento",
  other: "Otro",
};

export const STYLE_LABEL = { minimal: "Minimalista", editorial: "Editorial", classic: "Clásico", modern: "Moderno" };