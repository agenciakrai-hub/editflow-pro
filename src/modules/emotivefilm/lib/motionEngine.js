// Motor de movimiento cinematográfico (Ken Burns avanzado). Calcula los parámetros
// de transformación (escala + desplazamiento) para cada foto según su contenido y
// el movimiento asignado por el Film Plan. El reproductor aplica estos parámetros
// sobre un canvas con la imagen contenida (object-fit: contain).
//
// Movimientos soportados: zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down,
// dolly_in, ken_burns. Cada uno produce un { scaleStart, scaleEnd, panX, panY } donde
// panX/panY son fracciones del desplazamiento (-1..1) y scale es el factor de zoom.

const MOTION_PRESETS = {
  zoom_in:    { scaleStart: 1.0, scaleEnd: 1.15, panX: 0, panY: 0 },
  zoom_out:   { scaleStart: 1.15, scaleEnd: 1.0, panX: 0, panY: 0 },
  pan_left:   { scaleStart: 1.12, scaleEnd: 1.12, panX: 0.06, panY: 0 },
  pan_right:  { scaleStart: 1.12, scaleEnd: 1.12, panX: -0.06, panY: 0 },
  pan_up:     { scaleStart: 1.12, scaleEnd: 1.12, panX: 0, panY: 0.06 },
  pan_down:   { scaleStart: 1.12, scaleEnd: 1.12, panX: 0, panY: -0.06 },
  dolly_in:   { scaleStart: 1.0, scaleEnd: 1.2, panX: 0, panY: 0 },
  ken_burns:  { scaleStart: 1.05, scaleEnd: 1.18, panX: -0.04, panY: -0.03 },
};

export function resolveMotion(motion) {
  return MOTION_PRESETS[motion] || MOTION_PRESETS.ken_burns;
}

// Calcula la transformación en un instante t (0..1) de la duración de la foto.
// Devuelve { scale, panX, panY } listos para aplicar al canvas.
export function motionAt(motion, t) {
  const p = resolveMotion(motion);
  const tt = Math.max(0, Math.min(1, t));
  // Easing suave (easeInOutQuad) para que el movimiento no sea mecánico.
  const e = tt < 0.5 ? 2 * tt * tt : 1 - Math.pow(-2 * tt + 2, 2) / 2;
  return {
    scale: p.scaleStart + (p.scaleEnd - p.scaleStart) * e,
    panX: p.panX * e,
    panY: p.panY * e,
  };
}

// Intensidad de movimiento según el estilo y la configuración. Escala la amplitud
// del pan/zoom. motionIntensity 0-100 (AUTO = 50).
export function motionAmplitude(style, motionIntensity) {
  const base = motionIntensity == null || motionIntensity === "auto" ? 50 : Number(motionIntensity);
  const factor = base / 50; // 1.0 = estándar
  const styleMul = style === "dynamic" ? 1.4 : style === "elegant" || style === "luxury" ? 0.8 : 1.0;
  return factor * styleMul;
}