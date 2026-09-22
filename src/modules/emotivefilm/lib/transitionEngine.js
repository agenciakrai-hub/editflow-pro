// Motor de transiciones cinematográficas. Cada transición define cómo se mezcla
// la foto saliente con la entrante durante un breve solapamiento. El reproductor
// renderiza ambas imágenes en el canvas y aplica la transición según el progreso.
//
// Transiciones soportadas: cut, cross_dissolve, dip_to_black, soft_blur, zoom_transition,
// fade. "cut" no tiene solapamiento (cambio instantáneo); el resto usa un solapamiento
// configurable (por defecto 0.5s).
export const TRANSITION_DURATION = {
  cut: 0,
  cross_dissolve: 0.5,
  dip_to_black: 0.6,
  soft_blur: 0.4,
  zoom_transition: 0.5,
  fade: 0.8,
};

// Devuelve la duración del solapamiento de una transición (segundos).
export function transitionDuration(transition, transitionIntensity) {
  const base = TRANSITION_DURATION[transition] ?? 0.5;
  if (transition === "cut") return 0;
  const factor = transitionIntensity == null || transitionIntensity === "auto" ? 1 : Number(transitionIntensity) / 50;
  return Math.max(0.15, base * factor);
}

// Calcula el alpha y efecto de la foto SALIENTE y ENTRANTE en un instante t (0..1)
// de la transición. Devuelve { outAlpha, inAlpha, blurOut, blurIn, zoomIn }.
export function transitionState(transition, t) {
  const tt = Math.max(0, Math.min(1, t));
  switch (transition) {
    case "cut":
      return { outAlpha: 0, inAlpha: 1, blurOut: 0, blurIn: 0, zoomIn: 1 };
    case "cross_dissolve":
      return { outAlpha: 1 - tt, inAlpha: tt, blurOut: 0, blurIn: 0, zoomIn: 1 };
    case "dip_to_black": {
      // Baja a negro a la mitad y sube
      const dip = tt < 0.5 ? 1 - tt * 2 : (tt - 0.5) * 2;
      return { outAlpha: tt < 0.5 ? 1 - tt * 2 : 0, inAlpha: tt < 0.5 ? 0 : (tt - 0.5) * 2, blurOut: 0, blurIn: 0, zoomIn: 1, black: dip };
    }
    case "soft_blur": {
      const blur = 12 * tt;
      return { outAlpha: 1 - tt, inAlpha: tt, blurOut: blur, blurIn: 12 * (1 - tt), zoomIn: 1 };
    }
    case "zoom_transition":
      return { outAlpha: 1 - tt, inAlpha: tt, blurOut: 0, blurIn: 0, zoomIn: 1 + tt * 0.08 };
    case "fade":
      return { outAlpha: 1 - tt, inAlpha: tt, blurOut: 0, blurIn: 0, zoomIn: 1 };
    default:
      return { outAlpha: 1 - tt, inAlpha: tt, blurOut: 0, blurIn: 0, zoomIn: 1 };
  }
}