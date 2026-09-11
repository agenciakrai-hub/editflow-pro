// Agrupación de ráfagas — SEÑAL VISUAL LOCAL barata (sin IA, sin red): matriz 16×16
// en escala de grises de la preview sanitizada (≤512 px). Complementa al pHash
// (identidad global de escena, 8×8 DCT): la matriz fina captura continuidad de
// ENCUADRE y movimiento de SUJETOS (giro de cabeza, pose, expresión, sujeto que
// entra/sale) que el pHash no ve. Se calcula una vez por foto en E2 y alimenta
// a buildGroups (groupBuilder.js).
const GRID = 16;

export async function computeFrameSignal(dataUrl) {
  if (!dataUrl) return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("preview no decodificable"));
      image.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = GRID;
    canvas.height = GRID;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, GRID, GRID);
    const { data } = ctx.getImageData(0, 0, GRID, GRID);
    const sig = new Float32Array(GRID * GRID);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      sig[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sig;
  } catch {
    return null;
  }
}