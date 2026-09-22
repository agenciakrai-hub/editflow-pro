// AI Cinematic Camera Engine — genera movimientos de cámara dinámicos y
// personalizados por clip, en lugar de presets fijos. El motor analiza el
// contexto de cada foto (escena, emoción, posición del sujeto, orientación,
// intensidad musical) y compone un movimiento de cámara cinematográfico
// coherente: push-in íntimo para parejas, drift reverente para ceremonia,
// reveal dinámico para fiesta, hold para hero shots, etc.
//
// SALIDA: { scaleStart, scaleEnd, panX, panY, easing, parallax }
//   - scaleStart/End: factor de zoom (1.0 = sin zoom)
//   - panX/panY: fracción de desplazamiento (-1..1), dirección segura según sujeto
//   - easing: 'easeInOut' | 'easeOut' | 'linear' | 'hold' — tipo de curva
//   - parallax: true para sugerir profundidad (viñeta dinámica)
//
// El renderer (videoRenderer.js) consume estos parámetros igual que antes,
// pero ahora son generados dinámicamente, no lookup de tabla.

// Catálogo de arquetipos de movimiento cinematográfico. Cada arquetipo define
// la "intención" del movimiento. Los parámetros concretos se ajustan después
// según la intensidad, duración y posición del sujeto.
const CAMERA_ARCHETYPES = {
  // Push-in íntimo: acercamiento lento y suave hacia el sujeto.
  // Para parejas, besos, momentos emocionales. El sujeto crece en encuadre.
  push_in: {
    scaleRange: [1.0, 1.18],
    panAmplitude: 0.02,
    easing: "easeOut",
    parallax: false,
  },
  // Pull-out reveal: empieza cerca del sujeto y retrocede para revelar contexto.
  // Para transiciones de escena, establecimiento de lugar.
  pull_out: {
    scaleRange: [1.16, 1.0],
    panAmplitude: 0.03,
    easing: "easeInOut",
    parallax: false,
  },
  // Drift lateral: desplazamiento horizontal suave, siguiendo al sujeto.
  // Para ceremonia, procesiones, momentos de observación.
  drift: {
    scaleRange: [1.12, 1.12],
    panAmplitude: 0.07,
    easing: "easeInOut",
    parallax: false,
  },
  // Orbit simulado: drift diagonal + zoom suave que sugiere movimiento circular.
  // Para retratos dinámicos, momentos con energía.
  orbit: {
    scaleRange: [1.08, 1.2],
    panAmplitude: 0.05,
    easing: "easeInOut",
    parallax: true,
  },
  // Hold: movimiento mínimo, la foto "respira". Para hero shots, clímax.
  // El espectador absorbe la imagen sin distracción de cámara.
  hold: {
    scaleRange: [1.04, 1.06],
    panAmplitude: 0.01,
    easing: "hold",
    parallax: false,
  },
  // Macro push: acercamiento pronunciado para detalles (anillos, flores, manos).
  macro: {
    scaleRange: [1.0, 1.25],
    panAmplitude: 0.02,
    easing: "easeOut",
    parallax: false,
  },
  // Ken Burns clásico: zoom + pan diagonal suave. Fallback versátil.
  ken_burns: {
    scaleRange: [1.05, 1.18],
    panAmplitude: 0.04,
    easing: "easeInOut",
    parallax: false,
  },
};

// Mapa de escena → arquetipo de cámara. Determina el "carácter" del movimiento
// según el tipo de momento narrativo.
const SCENE_TO_ARCHETYPE = {
  // Momentos íntimos → push-in suave
  pareja: "push_in",
  beso: "push_in",
  novia: "push_in",
  novio: "push_in",
  retrato: "push_in",
  // Ceremonia → drift reverente
  ceremonia: "drift",
  iglesia: "drift",
  ritual: "drift",
  // Fiesta → orbit dinámico
  fiesta: "orbit",
  baile: "orbit",
  celebracion: "orbit",
  // Detalles → macro push
  detalles: "macro",
  detalle: "macro",
  anillos: "macro",
  flores: "macro",
  manos: "macro",
  // Preparativos → drift observacional
  preparativos: "drift",
  preparacion: "drift",
  // Establecimiento → pull-out reveal
  lugar: "pull_out",
  exterior: "pull_out",
  paisaje: "pull_out",
  // Hero / clímax → hold
  hero: "hold",
  climax: "hold",
};

// Selecciona el arquetipo de cámara para un clip según su escena.
// Si la escena no está mapeada, usa ken_burns como fallback versátil.
function archetypeForScene(scene) {
  if (!scene) return "ken_burns";
  const key = String(scene).toLowerCase().trim();
  return SCENE_TO_ARCHETYPE[key] || "ken_burns";
}

// Genera el movimiento de cámara dinámico para un clip.
// clip: { scene, intensity, subjectPosition, orientation, motion, duration, musicIntensity }
//   - motion: pista del Film Plan (zoom_in, pan_left, ken_burns, etc.) — se usa
//     como sugerencia, pero el arquetipo final lo determina la escena.
//   - musicIntensity: 0..1 intensidad musical en este punto (opcional).
// Devuelve { scaleStart, scaleEnd, panX, panY, easing, parallax }.
export function generateCameraMove(clip) {
  const scene = clip?.scene || "otros";
  const intensity = clip?.intensity ?? 50;
  const subjectPos = clip?.subjectPosition || "center";
  const orientation = clip?.orientation || "landscape";
  const musicIntensity = clip?.musicIntensity ?? 0.5;
  const duration = clip?.duration ?? 3;

  // 1. Selecciona el arquetipo según la escena.
  let archetypeName = archetypeForScene(scene);

  // HERO SHOT: siempre usa "hold" — la foto respira sin distracción de cámara.
  // El espectador absorbe la imagen. Solo un micro-movimiento (1.04→1.06).
  if (clip?.is_hero) {
    archetypeName = "hold";
  }

  // 2. Si el Film Plan dio una pista de movimiento explícita y es un arquetipo
  //    válido, la respetamos como override (el director IA puede pedir un
  //    movimiento concreto para un clip concreto) — EXCEPTO para hero shots,
  //    donde el hold es innegociable.
  if (!clip?.is_hero && clip?.motion && CAMERA_ARCHETYPES[clip.motion]) {
    archetypeName = clip.motion;
  }

  const arch = CAMERA_ARCHETYPES[archetypeName] || CAMERA_ARCHETYPES.ken_burns;

  // 3. Calcula la amplitud del movimiento según intensidad del clip + música.
  //    intensity 0-100 → 0-1. musicIntensity 0-1. Combinamos ambas.
  const clipEnergy = intensity / 100;
  const energy = Math.max(0.3, Math.min(1.5, 0.5 + clipEnergy * 0.5 + musicIntensity * 0.5));

  // 4. Ajusta la escala según la energía. Más energía → más zoom.
  const [sStart, sEnd] = arch.scaleRange;
  const zoomBoost = 1 + (energy - 0.5) * 0.15; // ±7.5% según energía
  const scaleStart = sStart * zoomBoost;
  const scaleEnd = sEnd * zoomBoost;

  // 5. Calcula la dirección del pan según la posición del sujeto.
  //    El pan SIEMPRE aleja al sujeto del borde (lo empuja hacia el centro).
  let panDirX = 0;
  let panDirY = 0;
  if (subjectPos === "left") {
    // Sujeto a la izquierda → pan positivo (imagen a la derecha) lo centra.
    panDirX = 1;
  } else if (subjectPos === "right") {
    panDirX = -1;
  } else {
    // Centro → pan diagonal sutil (dirección pseudo-aleatoria estable por hash).
    panDirX = (hashSign(clip?.hash) || 1) * 0.5;
  }

  // Para retratos verticales, añadimos un panY sutil si hay espacio vertical.
  if (orientation === "portrait") {
    panDirY = (hashSign(clip?.hash + "y") || 1) * 0.3;
  }

  // 6. Amplitud del pan según el arquetipo y la energía.
  const panAmp = arch.panAmplitude * energy;
  const panX = panDirX * panAmp;
  const panY = panDirY * panAmp;

  // 7. Para arquetipos con zoom direccional (push_in/pull_out), el pan es
  //    mínimo — el zoom es el protagonista. Para drift/orbit, el pan manda.
  let finalPanX = panX;
  let finalPanY = panY;
  if (archetypeName === "push_in" || archetypeName === "macro" || archetypeName === "pull_out") {
    finalPanX = panX * 0.3; // pan muy sutil, el zoom domina
    finalPanY = panY * 0.3;
  }

  // 8. Ajusta la curva de easing según la duración. Clips cortos → easeOut
  //    (llega rápido y se asienta). Clips largos → easeInOut (suave ida/vuelta).
  let easing = arch.easing;
  if (duration < 2 && easing === "easeInOut") easing = "easeOut";
  if (duration > 5 && archetypeName === "hold") easing = "hold";

  return {
    scaleStart,
    scaleEnd,
    panX: finalPanX,
    panY: finalPanY,
    easing,
    parallax: arch.parallax,
  };
}

// Función de easing cinematográfica. Soporta múltiples curvas además del
// easeInOutQuad del motor legacy.
// t: 0..1, easing: 'easeInOut' | 'easeOut' | 'linear' | 'hold'
export function cinematicEase(t, easing) {
  const tt = Math.max(0, Math.min(1, t));
  switch (easing) {
    case "easeOut":
      // easeOutQuad: rápido al principio, se desacelera al final.
      return 1 - (1 - tt) * (1 - tt);
    case "linear":
      return tt;
    case "hold":
      // Hold: movimiento mínimo, casi estático. Pequeña oscilación al final.
      return tt * 0.3 + 0.35;
    case "easeInOut":
    default:
      // easeInOutQuad: suave en ambos extremos.
      return tt < 0.5 ? 2 * tt * tt : 1 - Math.pow(-2 * tt + 2, 2) / 2;
  }
}

// Calcula la transformación de cámara en un instante t (0..1) usando el motor
// cinematográfico. Reemplaza a motionAt/motionAtSafe del motor legacy cuando
// el clip tiene contexto suficiente (scene, intensity, etc.).
export function cinematicAt(clip, t) {
  const move = generateCameraMove(clip);
  const e = cinematicEase(t, move.easing);
  return {
    scale: move.scaleStart + (move.scaleEnd - move.scaleStart) * e,
    panX: move.panX * e,
    panY: move.panY * e,
    parallax: move.parallax,
  };
}

// Versión segura que respeta la posición del sujeto (no lo saca del encuadre).
// El motor cinematográfico YA calcula la dirección del pan respetando al sujeto,
// pero esta función es el punto de entrada unificado para el renderer.
export function cinematicAtSafe(clip, t) {
  return cinematicAt(clip, t);
}

// Utilidad: genera un signo +1/-1 pseudo-aleatorio pero estable desde un string.
// Usa un hash simple para que el mismo clip siempre tenga la misma dirección.
function hashSign(str) {
  if (!str) return 1;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h % 2 === 0 ? 1 : -1;
}