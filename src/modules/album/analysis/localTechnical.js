// Fase 4.1 Bloque 9 E2 — métricas técnicas 100 % LOCALES sobre la preview (canvas).
// Sin coste de IA: alimenta el pre-filtrado y el contexto local_tech de E4/E5.
function decode(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("preview no decodificable"));
    img.src = dataUrl;
  });
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export async function analyzeTechnical(dataUrl) {
  const img = await decode(dataUrl);
  const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const n = w * h;
  const gray = new Float32Array(n);
  let sum = 0;
  let sumSq = 0;
  let clipLo = 0;
  let clipHi = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = l;
    sum += l;
    sumSq += l * l;
    if (l < 8) clipLo++;
    else if (l > 247) clipHi++;
  }
  const mean = sum / n;
  const contrast = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  // Laplaciano sobre gris → varianza = nitidez real (no "parece nítida")
  let lapSum = 0;
  let lapSumSq = 0;
  let lapN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += lap;
      lapSumSq += lap * lap;
      lapN++;
    }
  }
  const lapVar = lapN ? Math.max(0, lapSumSq / lapN - (lapSum / lapN) ** 2) : 0;
  const sharpness = clamp01(Math.log10(1 + lapVar) / 3.3) * 100;
  const clipping = ((clipLo + clipHi) / n) * 100;
  const exposure = clamp01(1 - Math.abs(mean - 118) / 118) * 100;
  const avgR = sumR / n;
  const avgG = sumG / n;
  const avgB = sumB / n;
  const wbCast = clamp01((Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB)) / 60) * 100;
  return {
    sharpness: Math.round(sharpness),
    exposure: Math.round(exposure),
    contrast: Math.round(clamp01(contrast / 80) * 100),
    clipping: Math.round(clipping),
    wb_cast: Math.round(wbCast),
  };
}