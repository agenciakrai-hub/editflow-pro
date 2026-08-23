// RAW AI Studio — motor TÉCNICO: mide objetivamente la distribución tonal de la preview
// (histograma de luminancia + RGB por canal, percentiles, clipping) para que los ajustes
// básicos de revelado no dependan de que un LLM "mire" la imagen y adivine un valor.
//
// LIMITACIÓN CONOCIDA (honesta, no se simula): esta preview es el JPEG embebido por la
// propia cámara (ya lleva su picture style/curva/contraste aplicados), no datos RAW
// lineales del sensor — este entorno de navegador no tiene acceso a un decodificador RAW
// lineal (no hay LibRaw/dcraw ni equivalente disponible). Es la mejor aproximación
// fotométrica posible sin integrar un componente externo especializado en RAW.
const MAX_DIM = 480;

function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo decodificar la preview para análisis fotométrico"));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

// Devuelve percentiles de luminancia (0-255) y porcentaje de píxeles saturados en
// blanco/negro puro (clipping), calculados sobre la preview reducida (rendimiento).
// Además devuelve el histograma RGB por canal (percentiles + clipping) para detectar
// quemados de un solo canal (p.ej. canal rojo de piel sobreexpuesta) que la luminancia
// por sí sola enmascara.
//
// Medición ponderada al centro (como el fotómetro de una cámara real): el sujeto de una
// boda suele estar cerca del centro del encuadre, así que un fondo muy claro u oscuro en
// los bordes ya no puede desplazar por sí solo la decisión de exposición tanto como el
// centro de la imagen.
export async function analyzePhotometrics(base64Jpeg) {
  const img = await loadImage(base64Jpeg);
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const histogram = new Array(256).fill(0);
  const histR = new Array(256).fill(0);
  const histG = new Array(256).fill(0);
  const histB = new Array(256).fill(0);
  let clipHighlight = 0, clipShadow = 0;
  let clipR = 0, clipG = 0, clipB = 0;
  const total = w * h;
  const cx = w / 2, cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;
  let totalWeight = 0;
  let idx = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = idx * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / maxDist; // 0 centro, 1 esquina
      const weight = 0.4 + 0.6 * (1 - dist); // 1 en el centro, 0.4 en las esquinas
      histogram[y] += weight;
      histR[r] += weight;
      histG[g] += weight;
      histB[b] += weight;
      totalWeight += weight;
      if (r >= 250 && g >= 250 && b >= 250) clipHighlight++;
      if (r <= 4 && g <= 4 && b <= 4) clipShadow++;
      if (r >= 250) clipR++;
      if (g >= 250) clipG++;
      if (b >= 250) clipB++;
      idx++;
    }
  }

  const percentile = (hist, p) => {
    const target = totalWeight * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };

  const channel = (hist, clip) => ({
    p95: percentile(hist, 0.95),
    p99: percentile(hist, 0.99),
    clipPct: clip / total,
  });

  return {
    p1: percentile(histogram, 0.01), p5: percentile(histogram, 0.05),
    p25: percentile(histogram, 0.25), p50: percentile(histogram, 0.5),
    p75: percentile(histogram, 0.75), p95: percentile(histogram, 0.95),
    p99: percentile(histogram, 0.99),
    clipHighlightPct: clipHighlight / total,
    clipShadowPct: clipShadow / total,
    globalContrast: (percentile(histogram, 0.95) - percentile(histogram, 0.05)),
    dynamicRange: (percentile(histogram, 0.99) - percentile(histogram, 0.01)),
    channels: {
      r: channel(histR, clipR),
      g: channel(histG, clipG),
      b: channel(histB, clipB),
    },
  };
}