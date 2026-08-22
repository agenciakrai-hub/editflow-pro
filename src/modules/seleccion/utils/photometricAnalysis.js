// Photometric analysis (wedding-raw-ai engine) — runs in the browser via canvas.
// Computes luminance, contrast, sharpness (Laplacian variance), highlight/shadow
// distribution from a loaded image element. No external dependencies.

export async function analyzeImage(imgElement) {
  const maxDim = 256;
  const scale = Math.min(1, maxDim / Math.max(imgElement.naturalWidth || maxDim, imgElement.naturalHeight || maxDim));
  const w = Math.max(1, Math.round((imgElement.naturalWidth || maxDim) * scale));
  const h = Math.max(1, Math.round((imgElement.naturalHeight || maxDim) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imgElement, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  const hist = new Array(256).fill(0);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = lum;
    sum += lum;
    hist[Math.min(255, Math.round(lum))]++;
  }
  const n = w * h;
  const mean = sum / n;
  let varSum = 0;
  for (let p = 0; p < n; p++) varSum += (gray[p] - mean) ** 2;
  const std = Math.sqrt(varSum / n);

  // Laplacian variance = sharpness proxy
  let lapSum = 0;
  let lapN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
      lapSum += lap * lap;
      lapN++;
    }
  }
  const sharpness = lapN ? lapSum / lapN : 0;

  const highlights = hist.slice(200).reduce((a, b) => a + b, 0) / n;
  const shadows = hist.slice(0, 55).reduce((a, b) => a + b, 0) / n;

  return {
    meanLuminance: mean / 255,
    contrast: std / 128,
    sharpness,
    highlights,
    shadows,
  };
}

export async function analyzeFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => analyzeImage(img).then(resolve, reject);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    img.src = url;
  });
}