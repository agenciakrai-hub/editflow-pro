// Fase 3.1 Bloque 1 — Identidad multicapa (diseño Fase 3 §2). Todo se calcula EN EL
// NAVEGADOR sobre los archivos locales: ningún byte sale del dispositivo.
// Niveles: L1 nombre+tamaño · L2 SHA-256 exacto · L3 pHash perceptual · L4 dimensiones.
export const FUZZY_PHASH_THRESHOLD = 8; // 64 bits: umbral ESTRICTO (ráfagas casi idénticas no deben pasar)

export async function computeContentHash(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hex64 = (n) => BigInt.asUintN(64, n).toString(16).padStart(16, "0");

// pHash local (aHash 8×8, 64 bits) aislado a propósito del núcleo EditFlow: el módulo
// album NO importa librerías del core (aislamiento verificado en Fase 2.5).
export function computePHashFromImage(img) {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const gray = [];
  for (let i = 0; i < 64; i++) gray.push((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3);
  const mean = gray.reduce((a, b) => a + b, 0) / 64;
  let h = 0n;
  for (let i = 0; i < 64; i++) if (gray[i] > mean) h |= (1n << BigInt(63 - i));
  return hex64(h);
}

export async function computePHashFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("No decodificable"));
    i.src = dataUrl;
  });
  return computePHashFromImage(img);
}

// Distancia Hamming entre dos pHash hex (0..64). Infinity si no son comparables.
export function phashHexDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    if (x & 1n) n += 1;
    x >>= 1n;
  }
  return n;
}