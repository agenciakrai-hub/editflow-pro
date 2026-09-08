// Cursores de mano — sistema de tres estados del editor de álbumes:
//   MANO BLANCA: modo global por defecto; solo panea el LIENZO completo
//   (nunca interviene en fotos ni contenedores).
//   MANO VERDE: se activa con UN CLIC sobre la foto; reencuadra la foto
//   dentro de su hueco (arrastrar + rueda para zoom).
//   MANO NEGRA: se activa con DOBLE CLIC sobre el hueco; mueve/redimensiona
//   el CONTENEDOR con la foto congelada.
// SVG data-URI (encodeURIComponent) → compatible con todos los navegadores.
const HAND_PATHS =
  '<path d="M18 11V6a2 2 0 0 0-4 0v5"/>' +
  '<path d="M14 10V4a2 2 0 0 0-4 0v2"/>' +
  '<path d="M10 10.5V6a2 2 0 0 0-4 0v8"/>' +
  '<path d="m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6C7.5 21.14 9.66 22 12 22c2.64 0 5.98-1.31 7.63-4.4.74-1.4 1.06-2.63 1.36-4.4.24-1.44-.55-2.9-2.03-2.9-.9 0-1.56.62-1.96 1.4"/>';

const handCursor = (fill, stroke) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${HAND_PATHS}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 14 14, grab`;
};

export const HAND_WHITE = handCursor("#FFFFFF", "#1a1a1a");
export const HAND_GREEN = handCursor("#16a34a", "#14532d");
export const HAND_BLACK = handCursor("#1a1a1a", "#ffffff");