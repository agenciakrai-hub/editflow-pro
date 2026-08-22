// Exposure engine (wedding-raw-ai) — computes the 13 basic adjustments from a
// photometric analysis of the photo. Self-contained (no cross-module imports)
// so the editor module stays isolated and testable on its own.

const TARGET_LUMA = 0.5;

async function analyzeFromUrl(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      const maxDim = 256;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const n = w * h;
      let sum = 0, varSum = 0, sharpSum = 0, sharpN = 0;
      const gray = new Float32Array(n);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray[p] = lum;
        sum += lum;
      }
      const mean = sum / n;
      for (let p = 0; p < n; p++) varSum += (gray[p] - mean) ** 2;
      const std = Math.sqrt(varSum / n);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
          sharpSum += lap * lap;
          sharpN++;
        }
      }
      resolve({ meanLuminance: mean / 255, contrast: std / 128, sharpness: sharpN ? sharpSum / sharpN : 0 });
    };
    img.onerror = () => resolve({ meanLuminance: 0.5, contrast: 0.5, sharpness: 0 });
    img.src = url;
  });
}

export async function computeAutoAdjustments(photo) {
  let metrics = { meanLuminance: 0.5, contrast: 0.5, sharpness: 0 };
  if (photo.file_url || photo.thumbnail_url) {
    metrics = await analyzeFromUrl(photo.file_url || photo.thumbnail_url);
  }

  return {
    exposure: clamp((TARGET_LUMA - metrics.meanLuminance) * 200),
    contrast: clamp((0.5 - metrics.contrast) * 120),
    highlights: clamp(metrics.meanLuminance > 0.6 ? -(metrics.meanLuminance - 0.6) * 200 : 10),
    shadows: clamp(metrics.meanLuminance < 0.4 ? (0.4 - metrics.meanLuminance) * 180 : 8),
    whites: clamp(metrics.meanLuminance > 0.65 ? -15 : 5),
    blacks: clamp(metrics.meanLuminance < 0.4 ? 12 : -4),
    temperature: clamp((metrics.meanLuminance - TARGET_LUMA) * -30),
    tint: 0,
    vibrance: clamp(15 - metrics.contrast * 20),
    saturation: clamp(5),
    clarity: clamp(8 + metrics.sharpness / 60),
    sharpness: clamp(20 + metrics.sharpness / 40, 0, 100),
  };
}

function clamp(v, min = -100, max = 100) {
  return Math.round(Math.max(min, Math.min(max, v)));
}

// CSS filter approximation for the before/after preview. Lightroom's tone
// curve, HSL, grading etc. have no direct CSS equivalent, so this is an
// approximation of the develop settings that DO map to CSS filters.
export function adjustmentsToCssFilter(a = {}) {
  const brightness = 1 + (a.exposure ?? 0) / 200;
  const contrast = 1 + (a.contrast ?? 0) / 200 + (a.clarity ?? 0) / 400 + (a.dehaze ?? 0) / 500 + (a.texture ?? 0) / 600;
  const saturate = Math.max(0, 1 + (a.vibrance ?? 0) / 150 + (a.saturation ?? 0) / 200);
  const warmth = (a.temperature ?? 0);
  const sepia = Math.max(0, warmth) / 400;
  const hue = (a.tint ?? 0) / 8 + (a.grading?.highlightsHue ? Math.sin((a.grading.highlightsHue * Math.PI) / 180) * 6 : 0);
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia}) hue-rotate(${hue}deg)`;
}

// CSS transform for the crop/straighten tools (rotate + flip + scale).
export function cropToCssTransform(crop = {}) {
  if (!crop) return "none";
  const angle = (crop.angle ?? 0) + (crop.rotate ?? 0);
  const flipX = crop.flipH ? -1 : 1;
  const flipY = crop.flipV ? -1 : 1;
  const scaleX = flipX * (1 + (crop.right ?? 0) / -200 + (crop.left ?? 0) / -200);
  const scaleY = flipY * (1 + (crop.top ?? 0) / -200 + (crop.bottom ?? 0) / -200);
  if (!angle && flipX === 1 && flipY === 1 && scaleX === 1 && scaleY === 1) return "none";
  return `rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;
}