// RAW AI Studio — motor TÉCNICO: mide objetivamente la distribución tonal de la preview
// (histograma, percentiles, clipping) para que exposición/luces/sombras no dependan
// únicamente de que un LLM "mire" la imagen y adivine un valor.
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

// Devuelve percentiles de luminancia (0-255) y porcentaje de píxeles realmente saturados en
// blanco/negro puro (clipping), calculados sobre la preview reducida (rendimiento).
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
  let clipHighlight = 0, clipShadow = 0;
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
      totalWeight += weight;
      if (r >= 250 && g >= 250 && b >= 250) clipHighlight++;
      if (r <= 4 && g <= 4 && b <= 4) clipShadow++;
      idx++;
    }
  }

  const percentile = (p) => {
    const target = totalWeight * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += histogram[v];
      if (acc >= target) return v;
    }
    return 255;
  };

  return {
    p1: percentile(0.01), p5: percentile(0.05), p25: percentile(0.25), p50: percentile(0.5),
    p75: percentile(0.75), p95: percentile(0.95), p99: percentile(0.99),
    clipHighlightPct: clipHighlight / total, clipShadowPct: clipShadow / total
  };
}