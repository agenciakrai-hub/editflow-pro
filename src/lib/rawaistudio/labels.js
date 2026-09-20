// RAW AI Studio — etiquetas de color estándar de Lightroom + escala de estrellas.
// Verde = "seleccionada para edición" (por defecto, decisión de la selección IA).
export const COLOR_LABELS = [
  { key: "none", label: "Sin color", color: "#52525b" },
  { key: "red", label: "Rojo", color: "#ef4444" },
  { key: "yellow", label: "Amarillo", color: "#eab308" },
  { key: "green", label: "Verde (seleccionada)", color: "#22c55e" },
  { key: "blue", label: "Azul", color: "#3b82f6" },
  { key: "purple", label: "Morado", color: "#a855f7" }
];

export const STAR_VALUES = [1, 2, 3, 4, 5];

// Traduce el colorLabel interno de la app (clave de COLOR_LABELS) a la etiqueta de color
// que Lightroom espera en xmp:Label ("" = sin color). Los valores son en ESPAÑOL porque
// el Lightroom del fotógrafo los reconoce así: Rojo, Amarillo, Verde, Azul, Púrpura.
// "green" (Verde) es el valor por defecto para fotos ya seleccionadas por la IA; si el
// fotógrafo cambia el color en la Revisión, ese cambio debe llegar tal cual al XMP final.
const LIGHTROOM_LABEL_BY_KEY = { none: "", red: "Rojo", yellow: "Amarillo", green: "Verde", blue: "Azul", purple: "Púrpura" };
export function lightroomLabelFor(colorLabel) {
  return LIGHTROOM_LABEL_BY_KEY[colorLabel] ?? "Verde";
}