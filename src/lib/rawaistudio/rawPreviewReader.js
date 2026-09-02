// RAW AI Studio — lector de RAW (solo lectura, nunca modifica el archivo original).
// Extrae el JPEG embebido de cualquier RAW (CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2/PEF), lee su
// orientación EXIF para auto-rotar la previsualización, y calcula métricas técnicas reales
// (nitidez, exposición) usadas por el motor de selección — todo en el navegador.

import { extractDngPreview } from "./dngPreviewExtractor";

// CR3 y DNG suelen contener VARIOS segmentos JPEG embebidos (miniatura + preview, a veces
// más). Emparejar el primer SOI de todo el archivo con el ÚLTIMO EOI (versión anterior)
// mezclaba distintos flujos JPEG en un solo blob corrupto — el navegador a veces lo
// "decodificaba" parcialmente, pero el validador de adjuntos de la IA lo rechazaba como
// "Invalid file attachment". Ahora cada SOI se empareja con su EOI más cercano, y se usa
// el segmento JPEG completo de mayor tamaño (la preview real, no la miniatura).
function findEmbeddedJpegSegments(bytes) {
  const segments = [];
  const len = bytes.length;
  let i = 0;
  while (i < len - 3) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      let j = i + 2;
      let eoi = -1;
      while (j < len - 1) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) { eoi = j; break; }
        if (j > i + 2 && bytes[j] === 0xff && bytes[j + 1] === 0xd8 && bytes[j + 2] === 0xff) break;
        j++;
      }
      if (eoi !== -1) {
        segments.push(bytes.slice(i, eoi + 2));
        i = eoi + 2;
        continue;
      }
    }
    i++;
  }
  return segments;
}

const readU16 = (bytes, o, little) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
const readU32 = (bytes, o, little) =>
  little
    ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
    : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;

// Lee el tag EXIF Orientation (0x0112) del JPEG embebido. Devuelve 1..8 o 1 si no existe.
function getExifOrientation(bytes) {
  let offset = 2;
  while (offset < bytes.length - 4 && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xe1) {
      const exifStart = offset + 4;
      if (bytes[exifStart] === 0x45 && bytes[exifStart + 1] === 0x78) {
        const tiffStart = exifStart + 6;
        const little = bytes[tiffStart] === 0x49;
        const ifdOffset = tiffStart + readU32(bytes, tiffStart + 4, little);
        const numEntries = readU16(bytes, ifdOffset, little);
        for (let i = 0; i < numEntries; i++) {
          const entryOffset = ifdOffset + 2 + i * 12;
          if (readU16(bytes, entryOffset, little) === 0x0112) return readU16(bytes, entryOffset + 8, little);
        }
      }
      return 1;
    }
    if (marker === 0xd8) { offset += 2; continue; }
    if (marker === 0xda) break;
    offset += 2 + readU16(bytes, offset + 2, false);
  }
  return 1;
}

function orientationToDegrees(orientation) {
  if (orientation === 3) return 180;
  if (orientation === 6) return 90;
  if (orientation === 8) return 270;
  return 0;
}

// CR3 (y otros contenedores) suelen incrustar VARIOS JPEG: una miniatura pequeña con Exif
// completo (incluyendo Orientation) y una preview grande que puede no llevar su propio
// segmento Exif. Usar solo el Exif del JPEG elegido como preview perdía la orientación en
// esos casos. Aquí se busca Orientation en CUALQUIER segmento embebido, y ese valor se
// aplica a la preview real (la de mayor tamaño), para que ambas queden siempre coherentes.
function findOrientationInSegments(segments) {
  for (const seg of segments) {
    const o = getExifOrientation(seg);
    if (o && o !== 1) return o;
  }
  return 1;
}

// Escanea el buffer buscando la firma "Exif\0\0" (presente en el box Exif de CR3 y en
// JPEG sueltos) y lee el tag Orientation (0x0112) de su IFD0. Más fiable para CR3 (y
// otros contenedores ISO-BMFF) que buscar solo dentro de los APP1 del JPEG embebido,
// que a veces no llevan su propio bloque de orientación.
function readExifOrientationFromSignature(bytes) {
  const SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const len = bytes.length;
  for (let i = 0; i < len - 8; i++) {
    if (
      bytes[i] === SIG[0] && bytes[i + 1] === SIG[1] && bytes[i + 2] === SIG[2] &&
      bytes[i + 3] === SIG[3] && bytes[i + 4] === SIG[4] && bytes[i + 5] === SIG[5]
    ) {
      const tiffStart = i + 6;
      if (tiffStart + 8 > len) continue;
      const little = bytes[tiffStart] === 0x49;
      if (readU16(bytes, tiffStart + 2, little) !== 0x2a) continue;
      const ifd0Offset = readU32(bytes, tiffStart + 4, little);
      if (tiffStart + ifd0Offset + 2 > len) continue;
      const numEntries = readU16(bytes, tiffStart + ifd0Offset, little);
      for (let k = 0; k < numEntries; k++) {
        const entryOffset = tiffStart + ifd0Offset + 2 + k * 12;
        if (entryOffset + 12 > len) break;
        if (readU16(bytes, entryOffset, little) === 0x0112) return readU16(bytes, entryOffset + 8, little);
      }
      // Sin tag Orientation en este bloque EXIF: sigue buscando otros "Exif\0\0".
    }
  }
  return null;
}

// Lee el tag Orientation (0x0112) directamente del IFD0 del propio contenedor TIFF/DNG —
// la fuente más fiable para RAW basados en TIFF (DNG y varios otros), ya que no depende de
// que exista o no un JPEG embebido con su propio bloque Exif.
function readTiffOrientation(bytes) {
  if (bytes.length < 8) return null;
  const isLE = bytes[0] === 0x49 && bytes[1] === 0x49;
  const isBE = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!isLE && !isBE) return null; // no es TIFF/DNG (ej. CR3 usa contenedor ISO-BMFF)
  const little = isLE;
  if (readU16(bytes, 2, little) !== 0x2a) return null;
  const ifd0Offset = readU32(bytes, 4, little);
  if (ifd0Offset <= 0 || ifd0Offset + 2 > bytes.length) return null;
  const numEntries = readU16(bytes, ifd0Offset, little);
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;
    if (readU16(bytes, entryOffset, little) === 0x0112) return readU16(bytes, entryOffset + 8, little);
  }
  return null;
}

// Analiza una fuente ya dibujable en canvas (HTMLImageElement o HTMLCanvasElement) — así
// una preview JPEG decodificada y una miniatura RGB sin comprimir (ver dngPreviewExtractor)
// pasan por la MISMA ruta de análisis, sin duplicar la lógica de histograma/nitidez.
function analyzeSource(source, srcW, srcH, maxEdge, rotationDeg) {
  const swap = rotationDeg === 90 || rotationDeg === 270;
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  if (canvas.width < 16 || canvas.height < 16) {
    throw new Error("Preview embebida inválida o demasiado pequeña");
  }
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bins = new Array(16).fill(0);
  const lums = new Float32Array(canvas.width * canvas.height);
  let sum = 0, clipped = 0;
  const total = canvas.width * canvas.height;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lums[p] = lum;
    bins[Math.min(15, Math.floor(lum / 16))]++;
    sum += lum;
    if (lum > 250 || lum < 5) clipped++;
  }
  // Nitidez (proxy): varianza media del gradiente horizontal de luminancia.
  let edgeSum = 0, edgeCount = 0;
  for (let y = 0; y < canvas.height; y++) {
    const row = y * canvas.width;
    for (let x = 1; x < canvas.width; x++) {
      const diff = lums[row + x] - lums[row + x - 1];
      edgeSum += diff * diff;
      edgeCount++;
    }
  }
  const sharpness = edgeCount ? edgeSum / edgeCount : 0;
  const exposureScore = Math.max(0, 1 - (clipped / total) * 4);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return {
    dataUrl,
    base64: dataUrl.split(",")[1],
    width: canvas.width,
    height: canvas.height,
    histogram: { bins, avgLuminance: Math.round(sum / total) },
    sharpness,
    exposureScore
  };
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo decodificar la preview embebida"));
    img.src = url;
  });
}

async function analyzeJpegBytes(jpegBytes, maxEdge, rotationDeg) {
  const blobUrl = URL.createObjectURL(new Blob([jpegBytes], { type: "image/jpeg" }));
  try {
    const img = await loadImageElement(blobUrl);
    return analyzeSource(img, img.naturalWidth, img.naturalHeight, maxEdge, rotationDeg);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// Convierte una miniatura RGB (o gris) sin comprimir, leída directamente de un IFD del
// DNG, en un canvas dibujable — sin pasar por un decodificador de imagen, porque no está
// comprimida: son bytes de píxel en bruto.
function analyzeRgbThumb(thumb, maxEdge, rotationDeg = 0) {
  const { width, height, samplesPerPixel, data } = thumb;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  for (let p = 0, s = 0; p < width * height; p++, s += samplesPerPixel) {
    if (samplesPerPixel >= 3) {
      imageData.data[p * 4] = data[s];
      imageData.data[p * 4 + 1] = data[s + 1];
      imageData.data[p * 4 + 2] = data[s + 2];
    } else {
      imageData.data[p * 4] = imageData.data[p * 4 + 1] = imageData.data[p * 4 + 2] = data[s];
    }
    imageData.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return analyzeSource(canvas, width, height, maxEdge, rotationDeg);
}

// Devuelve { dataUrl, base64, width, height, histogram, sharpness, exposureScore }.
// La preview solo se usa para el análisis visual de la IA (selección/exposición) — nunca
// para generar el XMP ni para tocar el RAW. Se busca en tres pasos, sin detener nunca el
// procesamiento por no tener un JPEG suelto en el archivo (algunos DNG, incluidos varios
// de Leica, no lo tienen aunque el RAW sea perfectamente válido):
// 1) JPEG embebido detectado por escaneo de bytes (rápido, cubre CR2/CR3/NEF/ARW/RAF...).
// 2) Si no hay, se recorre la estructura de IFDs del propio DNG buscando su preview real
//    (JPEG por offset/tamaño declarado, o una miniatura sin comprimir).
// 3) Solo si ninguna de las dos existe se lanza error — eso sí sería un RAW sin ninguna
//    preview embebida de ningún tipo.
export async function extractRawPreview(file, maxEdge = 800, { autoRotate = true, bytes: sharedBytes } = {}) {
  // Si el llamador ya leyó el buffer (ej. para extraer metadatos de cámara a la vez),
  // se reutiliza y no se vuelve a leer el RAW del disco — en lotes grandes esto evita
  // miles de lecturas duplicadas de archivos de decenas de MB (DNG/CR3).
  const bytes = sharedBytes || new Uint8Array(await file.arrayBuffer());

  // Orientación real del RAW: para contenedores TIFF/DNG se lee directamente del IFD0 del
  // propio archivo (la fuente más fiable). Para CR3 y similares (contenedor ISO-BMFF, sin
  // TIFF) se busca en cualquiera de los JPEG embebidos, no solo en el elegido como preview.
  const tiffOrientation = readTiffOrientation(bytes);
  const sigOrientation = readExifOrientationFromSignature(bytes);

  const segments = findEmbeddedJpegSegments(bytes);
  if (segments.length) {
    const jpegBytes = segments.reduce((best, seg) => (seg.length > best.length ? seg : best));
    const orientation = tiffOrientation || sigOrientation || findOrientationInSegments(segments);
    const rotationDeg = autoRotate ? orientationToDegrees(orientation) : 0;
    return analyzeJpegBytes(jpegBytes, maxEdge, rotationDeg);
  }

  const rotationDeg = autoRotate ? orientationToDegrees(tiffOrientation || sigOrientation || 1) : 0;
  const dngPreview = extractDngPreview(bytes);
  if (dngPreview?.type === "jpeg") return analyzeJpegBytes(dngPreview.bytes, maxEdge, rotationDeg);
  if (dngPreview?.type === "rgb") return analyzeRgbThumb(dngPreview, maxEdge, rotationDeg);

  throw new Error("Sin preview embebida en el RAW (ni JPEG ni miniatura sin comprimir)");
}

// Preview placeholder para RAW sin preview embebida decodificable (ej. DNG de Leica sin
// JPEG válido). Devuelve un objeto con la misma forma que extractRawPreview, pero con una
// imagen gris uniforme de 4x4 — suficiente para que la tarjeta de revisión no muestre un
// icono de imagen rota, y para que el motor cloud tenga algo que subir sin fallar.
const PLACEHOLDER_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgAB//Z";
export function placeholderPreview() {
  return { dataUrl: PLACEHOLDER_DATA_URL, base64: PLACEHOLDER_DATA_URL.split(",")[1], width: 4, height: 4, histogram: { bins: new Array(16).fill(0), avgLuminance: 128 }, sharpness: 0, exposureScore: 0.5, isPlaceholder: true };
}

export const RAW_EXTENSIONS = [
  ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw", ".x3f",
  ".rwl", ".3fr", ".iiq", ".dcr", ".kdc", ".erf", ".mef", ".mos", ".gpr", ".raw"
];

// Lista blanca: solo estas extensiones son RAW. Cualquier otra cosa (JPEG, XMP, PDFs,
// documentos, archivos ocultos del sistema...) queda fuera del pipeline por definición,
// nunca por una lista negra que haya que ir ampliando.
export function isRawFile(name) {
  const lower = name.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Archivos ocultos/del sistema que macOS, Windows o el propio navegador pueden incluir al
// leer una carpeta (.DS_Store, ._AppleDouble, papelera, Spotlight, Thumbs.db...). Se
// descartan explícitamente ANTES de mirar la extensión, aunque ya no pasarían la lista
// blanca de arriba — así queda claro que nunca deben llegar a Storage ni al backend.
export function isHiddenOrSystemFile(name) {
  const base = name.split("/").pop();
  if (base.startsWith(".")) return true; // .DS_Store, ._foo, .Trashes, .Spotlight-V100...
  return ["thumbs.db", "desktop.ini"].includes(base.toLowerCase());
}