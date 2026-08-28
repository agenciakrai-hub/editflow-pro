// RAW AI Studio — hash perceptual (aHash) para detección de duplicados/similares.
// Downscale a 8x8 en gris, umbral por la media → 64 bits. Robusto frente a cambios
// de brillo/contraste menores y a recompresión; capta tomas casi idénticas de una
// misma ráfaga. NO es una medida de calidad: solo de similitud visual. Solo lectura.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la preview para pHash"));
    img.src = url;
  });
}

// Devuelve el hash como BigInt (64 bits) o null si no se pudo calcular.
export async function computePHash(dataUrl, decodedSource = null) {
  if (!dataUrl) return null;
  try {
    const img = decodedSource || await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 8, 8);
    const { data } = ctx.getImageData(0, 0, 8, 8);
    const grays = new Array(64);
    let sum = 0;
    for (let i = 0; i < 64; i++) {
      const p = i * 4;
      const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      grays[i] = g;
      sum += g;
    }
    const mean = sum / 64;
    let hash = 0n;
    for (let i = 0; i < 64; i++) {
      if (grays[i] > mean) hash |= (1n << BigInt(i));
    }
    return hash;
  } catch {
    return null;
  }
}

// Distancia Hamming entre dos hashes (número de bits distintos). -1 si alguno es null.
export function phashDistance(a, b) {
  if (a == null || b == null) return -1;
  const xor = a ^ b;
  // popcount sobre BigInt
  let bits = xor;
  let count = 0;
  while (bits > 0n) {
    bits &= bits - 1n;
    count++;
  }
  return count;
}

export function phashHex(hash) {
  if (hash == null) return null;
  return hash.toString(16).padStart(16, "0");
}