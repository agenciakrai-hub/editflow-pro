// Analizador de música — 100% cliente (Web Audio API). No sube el audio a ningún
// servidor. Decodifica el archivo, detecta BPM, extrae beats, construye una curva
// de intensidad y divide la canción en secciones (intro, verso, estribillo, clímax...).
//
// Limitaciones honestas: la detección de BPM/beat en el navegador es aproximada
// (espectro de energía + autocorrelación). No es tan precisa como libroska, pero
// es suficiente para sincronizar el montaje. La curva de intensidad se deriva del
// RMS por ventanas, que correlaciona bien con la sensación de "sube/baja" la canción.

// Decodifica un File de audio a un AudioBuffer.
export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  // AudioContext se crea bajo demanda (no a nivel de módulo: el navegador lo
  // bloquea hasta que hay interacción del usuario).
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return audioBuffer;
  } finally {
    // No cerramos el ctx aquí: lo reutiliza el reproductor. Pero si solo se
    // analiza, se puede cerrar fuera.
  }
}

// Detecta BPM por autocorrelación de la envolvente de energía (onset envelope).
export function detectBPM(audioBuffer) {
  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.getChannelData(0);
  const winSize = 1024;
  const hop = 512;
  const env = [];
  for (let i = 0; i + winSize < ch.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < winSize; j++) sum += ch[i + j] * ch[i + j];
    env.push(Math.sqrt(sum / winSize));
  }
  // Diferencia (onset strength)
  const diff = [];
  for (let i = 1; i < env.length; i++) diff.push(Math.max(0, env[i] - env[i - 1]));
  // Autocorrelación en el rango de BPM plausible (60-200)
  const minLag = Math.floor((60 * sr) / hop / 200);
  const maxLag = Math.floor((60 * sr) / hop / 60);
  let bestLag = minLag, bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i + lag < diff.length; i++) corr += diff[i] * diff[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  const bpm = Math.round((60 * sr) / hop / bestLag);
  // Doble/medio ajuste para caer en rango audible
  let final = bpm;
  if (final < 70) final *= 2;
  if (final > 180) final = Math.round(final / 2);
  return Math.max(60, Math.min(200, final));
}

// Curva de intensidad: RMS por ventanas de ~1s. Normalizada 0-1.
export function buildIntensityCurve(audioBuffer, segmentSec = 1) {
  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.getChannelData(0);
  const segLen = Math.floor(sr * segmentSec);
  const curve = [];
  for (let i = 0; i + segLen < ch.length; i += segLen) {
    let sum = 0;
    for (let j = 0; j < segLen; j++) sum += ch[i + j] * ch[i + j];
    curve.push(Math.sqrt(sum / segLen));
  }
  const max = Math.max(...curve, 0.001);
  return curve.map((v) => v / max);
}

// Extrae beats aproximados: picos de la envolvente de onset por encima de un
// umbral adaptativo. Devuelve timestamps en segundos.
export function extractBeats(audioBuffer) {
  const sr = audioBuffer.sampleRate;
  const ch = audioBuffer.getChannelData(0);
  const winSize = 1024;
  const hop = 512;
  const env = [];
  for (let i = 0; i + winSize < ch.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < winSize; j++) sum += ch[i + j] * ch[i + j];
    env.push(Math.sqrt(sum / winSize));
  }
  const diff = [];
  for (let i = 1; i < env.length; i++) diff.push(Math.max(0, env[i] - env[i - 1]));
  const mean = diff.reduce((a, b) => a + b, 0) / (diff.length || 1);
  const threshold = mean * 1.5;
  const beats = [];
  let lastBeat = -1;
  const minGap = Math.floor((60 * sr) / hop / 200); // mínimo 200 BPM
  for (let i = 0; i < diff.length; i++) {
    if (diff[i] > threshold && i - lastBeat > minGap) {
      beats.push((i * hop) / sr);
      lastBeat = i;
    }
  }
  return beats;
}

// Divide la canción en secciones detectando cambios de energía reales (change-point
// detection) en lugar de dividir por tercios fijos. Suaviza la curva, busca
// transiciones significativas y etiqueta cada sección por su posición y energía.
// Detecta: intro, verso, estribillo, puente, subida, clímax, outro.
export function buildSections(intensityCurve, durationSec, segmentSec = 1) {
  if (!intensityCurve.length) return { sections: [], climax_at: 0 };
  const n = intensityCurve.length;

  // 1. Suaviza la curva con media móvil (ventana 3).
  const smoothed = smoothCurve(intensityCurve, 3);

  // 2. Clímax: ventana de mayor intensidad sostenida.
  let climaxAt = 0, climaxVal = 0;
  const windowSize = Math.max(3, Math.floor(n / 10));
  for (let i = 0; i + windowSize < n; i++) {
    const w = avg(smoothed.slice(i, i + windowSize));
    if (w > climaxVal) { climaxVal = w; climaxAt = (i + windowSize / 2) * segmentSec; }
  }

  // 3. Detecta puntos de cambio: donde la derivada de la energía supera un umbral.
  const changePoints = findChangePoints(smoothed, n);

  // 4. Crea secciones entre puntos de cambio y etiqueta cada una.
  const sections = [];
  const allPoints = [0, ...changePoints, n];
  for (let i = 0; i < allPoints.length - 1; i++) {
    const start = allPoints[i];
    const end = allPoints[i + 1];
    const energy = avg(smoothed.slice(start, end));
    const position = start / n; // 0..1
    const name = labelSection(position, energy, i, allPoints.length - 2, climaxAt / segmentSec, start, end);
    sections.push({
      name,
      start: start * segmentSec,
      end: end * segmentSec,
      intensity: Math.round(energy * 100),
    });
  }

  return { sections, climax_at: climaxAt };
}

// Suaviza una curva con media móvil de ventana `radius`.
function smoothCurve(curve, radius) {
  const out = new Array(curve.length);
  for (let i = 0; i < curve.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(curve.length - 1, i + radius); j++) {
      sum += curve[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

// Encuentra puntos donde la energía cambia significativamente (transiciones
// entre verso/estribillo, subidas/bajadas bruscas). Devuelve índices en la curva.
function findChangePoints(curve, n) {
  if (n < 8) return [];
  const points = [];
  const minSectionLen = Math.max(3, Math.floor(n / 15)); // sección mínima ~6% de la canción
  // Calcula la derivada comparando ventanas antes/después de cada punto.
  const deriv = [];
  const halfWin = 3;
  for (let i = halfWin; i < n - halfWin; i++) {
    const before = avg(curve.slice(i - halfWin, i));
    const after = avg(curve.slice(i, i + halfWin));
    deriv.push(Math.abs(after - before));
  }
  // Umbral adaptativo: percentil 70 de las derivadas (los cambios más fuertes).
  const sorted = [...deriv].sort((a, b) => a - b);
  const p70 = sorted[Math.floor(sorted.length * 0.7)] || 0;
  const threshold = Math.max(p70, 0.08); // mínimo 0.08 de cambio para contar
  let lastPoint = 0;
  for (let i = 0; i < deriv.length; i++) {
    if (deriv[i] > threshold && i + halfWin - lastPoint >= minSectionLen) {
      points.push(i + halfWin);
      lastPoint = i + halfWin;
    }
  }
  return points;
}

// Etiqueta una sección según su posición en la canción, su energía y el clímax.
function labelSection(position, energy, idx, totalSections, climaxIdx, start, end) {
  const isNearClimax = Math.abs((start + end) / 2 - climaxIdx) < (end - start) * 1.5;
  // Si la sección contiene el clímax y tiene alta energía → "climax"
  if (isNearClimax && energy > 0.6) return "climax";
  // Por posición relativa
  if (position < 0.08) return "intro";
  if (position > 0.92) return "outro";
  // Por energía
  if (energy > 0.75) return "estribillo";
  if (energy > 0.5) return "subida";
  if (energy < 0.25) return "puente";
  // Si es una sección intermedia de energía media → verso
  return "verso";
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Análisis completo: decodifica + BPM + beats + intensidad + secciones.
// Devuelve un objeto serializable listo para guardar en la entidad.
export async function analyzeMusic(file) {
  const audioBuffer = await decodeAudioFile(file);
  const durationSec = audioBuffer.duration;
  const bpm = detectBPM(audioBuffer);
  const beats = extractBeats(audioBuffer);
  const intensityCurve = buildIntensityCurve(audioBuffer, 1);
  const { sections, climax_at } = buildSections(intensityCurve, durationSec, 1);
  return {
    name: file.name,
    duration_sec: Math.round(durationSec * 10) / 10,
    bpm,
    beats: beats.slice(0, 500), // limita tamaño para persistencia
    intensity_curve: intensityCurve.map((v) => Math.round(v * 100) / 100),
    sections,
    climax_at: Math.round(climax_at * 10) / 10,
  };
}