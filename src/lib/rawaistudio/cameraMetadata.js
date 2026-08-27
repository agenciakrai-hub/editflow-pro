import { xyToKelvin, neutralToKelvin } from "./kelvinColor";
// RAW AI Studio — lector de metadatos de cámara (solo lectura, nunca modifica el RAW).
// Determina Make/Model y, cuando el formato lo permite, si el SENSOR es monocromo real
// (ej. Leica M Monochrom) analizando la estructura TIFF/DNG del propio archivo RAW —
// nunca a partir de la preview JPEG embebida, que puede no coincidir con los datos RAW.

const readU16 = (b, o, le) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
const readU32 = (b, o, le) =>
  le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

function readIfdEntries(bytes, tiffStart, ifdOffset, little) {
  const entries = [];
  if (ifdOffset <= 0 || tiffStart + ifdOffset + 2 > bytes.length) return entries;
  const count = readU16(bytes, tiffStart + ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;
    const tag = readU16(bytes, entryOffset, little);
    const type = readU16(bytes, entryOffset + 2, little);
    const num = readU32(bytes, entryOffset + 4, little);
    const size = (TYPE_SIZE[type] || 1) * num;
    const valueOffset = size > 4 ? tiffStart + readU32(bytes, entryOffset + 8, little) : entryOffset + 8;
    entries.push({ tag, type, num, valueOffset });
  }
  return entries;
}

const findTag = (entries, tag) => entries.find((e) => e.tag === tag) || null;

function getString(bytes, entry) {
  let end = entry.valueOffset;
  const limit = Math.min(bytes.length, entry.valueOffset + entry.num);
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.slice(entry.valueOffset, end)).trim();
}

function getNumber(bytes, entry, little) {
  if (entry.type === 3) return readU16(bytes, entry.valueOffset, little);
  if (entry.type === 4) return readU32(bytes, entry.valueOffset, little);
  return bytes[entry.valueOffset];
}

// PhotometricInterpretation (tag 262): 1 = BlackIsZero → sin filtro de color, sensor
// monocromo real (Leica M Monochrom). 32803 (CFA) / 34892 (LinearRaw) → datos de color.
function readMainTiffCameraInfo(bytes) {
  if (bytes.length < 8) return null;
  const isLE = bytes[0] === 0x49 && bytes[1] === 0x49;
  const isBE = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!isLE && !isBE) return null; // no es TIFF/DNG (ej. CR3 usa contenedor ISO-BMFF)
  const little = isLE;
  if (readU16(bytes, 2, little) !== 0x2a) return null;

  const ifd0 = readIfdEntries(bytes, 0, readU32(bytes, 4, little), little);
  if (!ifd0.length) return null;

  const makeEntry = findTag(ifd0, 271);
  const modelEntry = findTag(ifd0, 272);
  const make = makeEntry ? getString(bytes, makeEntry) : "";
  const model = modelEntry ? getString(bytes, modelEntry) : "";

  // La imagen RAW real puede estar en IFD0 o en uno de sus SubIFDs (tag 330) — nos
  // quedamos con la de mayor ancho para leer su PhotometricInterpretation real.
  const candidates = [ifd0];
  const subIfdsEntry = findTag(ifd0, 330);
  if (subIfdsEntry) {
    for (let i = 0; i < subIfdsEntry.num; i++) {
      const off = readU32(bytes, subIfdsEntry.valueOffset + i * 4, little);
      candidates.push(readIfdEntries(bytes, 0, off, little));
    }
  }

  let bestPhotoEntry = null, bestWidth = -1;
  for (const ifd of candidates) {
    const photoEntry = findTag(ifd, 262);
    if (!photoEntry) continue;
    const widthEntry = findTag(ifd, 256);
    const width = widthEntry ? getNumber(bytes, widthEntry, little) : 0;
    if (width >= bestWidth) { bestWidth = width; bestPhotoEntry = photoEntry; }
  }
  const photometric = bestPhotoEntry ? getNumber(bytes, bestPhotoEntry, little) : null;
  const isMonochrome = photometric === 1 ? true : photometric != null ? false : null;

  return { make, model, isMonochrome, source: "raw_ifd" };
}

// Fallback para formatos no-TIFF (ej. CR3): Make/Model desde el EXIF del JPEG embebido.
// Nunca se usa para decidir monocromo — la preview no es representativa del sensor RAW.
function readCameraInfoFromEmbeddedJpeg(bytes) {
  let i = 0;
  let jpegStart = -1;
  while (i < bytes.length - 3) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) { jpegStart = i; break; }
    i++;
  }
  if (jpegStart === -1) return null;

  let offset = jpegStart + 2;
  while (offset < bytes.length - 4 && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xe1) {
      const exifStart = offset + 4;
      if (bytes[exifStart] === 0x45 && bytes[exifStart + 1] === 0x78) {
        const tiffStart = exifStart + 6;
        const little = bytes[tiffStart] === 0x49;
        const entries = readIfdEntries(bytes, tiffStart, readU32(bytes, tiffStart + 4, little), little);
        const makeEntry = findTag(entries, 271);
        const modelEntry = findTag(entries, 272);
        return {
          make: makeEntry ? getString(bytes, makeEntry) : "",
          model: modelEntry ? getString(bytes, modelEntry) : "",
          isMonochrome: null,
          source: "preview_exif"
        };
      }
      return null;
    }
    if (marker === 0xd8) { offset += 2; continue; }
    if (marker === 0xda) break;
    offset += 2 + readU16(bytes, offset + 2, false);
  }
  return null;
}

const BRAND_KEYWORDS = ["Canon", "Leica", "Nikon", "Sony", "Fujifilm", "Fuji", "Panasonic", "Olympus", "Pentax", "Hasselblad", "Phase One"];

export function brandFromMake(make) {
  const m = (make || "").toLowerCase();
  return BRAND_KEYWORDS.find((b) => m.includes(b.toLowerCase())) || (make || "Desconocida");
}

// Versión sincrona que parte de los bytes ya leídos del archivo. Permite reutilizar el
// mismo buffer para extraer metadatos Y preview sin leer el RAW dos veces del disco.
export function readCameraMetadataFromBytes(bytes) {
  const mainInfo = readMainTiffCameraInfo(bytes);
  if (mainInfo && (mainInfo.make || mainInfo.model)) {
    return { ...mainInfo, brand: brandFromMake(mainInfo.make) };
  }
  const fallback = readCameraInfoFromEmbeddedJpeg(bytes);
  if (fallback) return { ...fallback, brand: brandFromMake(fallback.make) };
  return { make: "", model: "", isMonochrome: null, brand: "Desconocida", source: "none" };
}

// Lee Make/Model y, cuando es posible (DNG/TIFF), si el sensor RAW es monocromo real.
export async function readCameraMetadata(file) {
  const buffer = await file.arrayBuffer();
  return readCameraMetadataFromBytes(new Uint8Array(buffer));
}

// Lee un SRATIONAL (int32 / int32) del buffer. Usado para los tags DNG AsShotNeutral /
// AsShotWhiteXY, que viven en IFD0 como SRATIONAL arrays.
function readSRational(bytes, offset, little) {
  const num = readU32(bytes, offset, little) | 0; // |0 → signed int32
  const den = readU32(bytes, offset + 4, little) | 0;
  if (den === 0) return NaN;
  return num / den;
}

// WB As Shot del RAW — SOLO para DNG (tags estándar AsShotNeutral / AsShotWhiteXY en IFD0).
// Para RAW propietarios (CR3/CR2/NEF/ARW/RAF...) el WB vive en MakerNotes privados por marca
// que este lector no parsea → devuelve null (el motor NO escribirá WB y Lightroom conservará
// el original). Nunca aproxima ni inventa: sin tag fiable, no hay baseline.
//   Devuelve { kelvin, tint, source } o null.
export function readAsShotWhiteBalance(bytes) {
  if (bytes.length < 8) return null;
  const isLE = bytes[0] === 0x49 && bytes[1] === 0x49;
  const isBE = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!isLE && !isBE) return null; // no es TIFF/DNG (CR3 = ISO-BMFF)
  const little = isLE;
  if (readU16(bytes, 2, little) !== 0x2a) return null;
  const ifd0 = readIfdEntries(bytes, 0, readU32(bytes, 4, little), little);
  if (!ifd0.length) return null;

  // AsShotWhiteXY (0xD6C2): 2 SRATIONALs → cromaticidad x,y directa (más fiable).
  const xyEntry = findTag(ifd0, 0xd6c2);
  if (xyEntry) {
    const x = readSRational(bytes, xyEntry.valueOffset, little);
    const y = readSRational(bytes, xyEntry.valueOffset + 8, little);
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 && x < 1 && y < 1) {
      const kelvin = xyToKelvin(x, y);
      if (Number.isFinite(kelvin) && kelvin > 1500 && kelvin < 12000) {
        return { kelvin: Math.round(kelvin), tint: 0, source: "dng-AsShotWhiteXY" };
      }
    }
  }

  // AsShotNeutral (0xD6C1): 3 SRATIONALs → R,G,B camera-neutral (normalizamos G=1).
  const neutralEntry = findTag(ifd0, 0xd6c1);
  if (neutralEntry) {
    const r = readSRational(bytes, neutralEntry.valueOffset, little);
    const g = readSRational(bytes, neutralEntry.valueOffset + 8, little);
    const b = readSRational(bytes, neutralEntry.valueOffset + 16, little);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && g > 0) {
      const kelvin = neutralToKelvin(r / g, 1, b / g);
      if (Number.isFinite(kelvin) && kelvin > 1500 && kelvin < 12000) {
        return { kelvin: Math.round(kelvin), tint: 0, source: "dng-AsShotNeutral" };
      }
    }
  }
  return null;
}