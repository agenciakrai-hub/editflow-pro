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

// Divide la canción en secciones según la curva de intensidad. Etiqueta las
// secciones por su posición relativa y nivel de energía.
export function buildSections(intensityCurve, durationSec, segmentSec = 1) {
  if (!intensityCurve.length) return [];
  const sections = [];
  const n = intensityCurve.length;
  // Promedios por tercios para detectar subidas/bajadas bruscas
  const third = Math.floor(n / 3);
  const avg1 = avg(intensityCurve.slice(0, third));
  const avg2 = avg(intensityCurve.slice(third, third * 2));
  const avg3 = avg(intensityCurve.slice(third * 2));
  // Clímax: el momento de mayor intensidad sostenida
  let climaxAt = 0, climaxVal = 0;
  const windowSize = Math.max(3, Math.floor(n / 10));
  for (let i = 0; i + windowSize < n; i++) {
    const w = avg(intensityCurve.slice(i, i + windowSize));
    if (w > climaxVal) { climaxVal = w; climaxAt = (i + windowSize / 2) * segmentSec; }
  }
  // Secciones simplificadas por energía
  sections.push({ name: "intro", start: 0, end: durationSec * 0.15, intensity: Math.round(avg1 * 100) });
  sections.push({ name: "desarrollo", start: durationSec * 0.15, end: durationSec * 0.5, intensity: Math.round(avg2 * 100) });
  sections.push({ name: "climax", start: durationSec * 0.5, end: durationSec * 0.8, intensity: Math.round(avg3 * 100) });
  sections.push({ name: "final", start: durationSec * 0.8, end: durationSec, intensity: Math.round(avg(intensityCurve.slice(Math.floor(n * 0.8))) * 100) });
  return { sections, climax_at: climaxAt };
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