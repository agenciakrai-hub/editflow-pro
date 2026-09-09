// RAW AI Studio — lector del tiempo real de captura (EXIF) y parámetros de exposición.
// Solo lectura: nunca modifica el RAW. Escanea el buffer completo buscando la firma
// "Exif\0\0" (funciona tanto para JPEG sueltos como para el JPEG embebido dentro de
// CR2/CR3/NEF/ARW/DNG...), y desde ahí navega el árbol TIFF: IFD0 (DateTime 0x0132) y
// el ExifIFD apuntado por 0x8769 (DateTimeOriginal 0x9003, FocalLength 0x920A,
// FNumber 0x829D, ExposureTime 0x829A, ISOSpeedRatings 0x8827).
//
// ¿Por qué no usar file.lastModified? Porque ese valor es la fecha de copia/descarga
// del archivo en el equipo del usuario, NO la fecha de captura: una carpeta entera de
// una boda copiada hoy tendría el mismo lastModified y se fundiría en una sola "ráfaga".
// DateTimeOriginal es el instante real en que se tomó la foto → agrupación de ráfagas real.

const SIG = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function findExifStart(bytes) {
  const len = bytes.length;
  for (let i = 0; i < len - 6; i++) {
    if (
      bytes[i] === SIG[0] && bytes[i + 1] === SIG[1] && bytes[i + 2] === SIG[2] &&
      bytes[i + 3] === SIG[3] && bytes[i + 4] === SIG[4] && bytes[i + 5] === SIG[5]
    ) return i + 6;
  }
  return -1;
}

// Fallback CR3: en el contenedor ISO-BMFF (.cr3 de Canon) el bloque EXIF empieza
// DIRECTO con la cabecera TIFF ("II*\0" / "MM\0*"), sin la firma "Exif\0\0".
// Sin este fallback, las .CR3 no tienen hora de captura y la galería pierde el
// orden cronológico.
function findTiffStart(bytes) {
  const len = bytes.length;
  for (let i = 0; i < len - 4; i++) {
    if (
      (bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2a && bytes[i + 3] === 0x00) ||
      (bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 2] === 0x00 && bytes[i + 3] === 0x2a)
    ) return i;
  }
  return -1;
}

const readU16 = (b, o, le) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
const readU32 = (b, o, le) =>
  le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

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

function readAscii(bytes, entry) {
  let end = entry.valueOffset;
  const limit = Math.min(bytes.length, entry.valueOffset + entry.num);
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.slice(entry.valueOffset, end)).trim();
}

function readRational(bytes, entry, little) {
  // type 5 = RATIONAL (8 bytes: num/den)
  const num = readU32(bytes, entry.valueOffset, little);
  const den = readU32(bytes, entry.valueOffset + 4, little);
  return den ? num / den : 0;
}

function readShort(bytes, entry, little) {
  return readU16(bytes, entry.valueOffset, little);
}

// "YYYY:MM:DD HH:MM:SS" -> epoch ms (local). Devuelve null si no parsea.
function parseExifDate(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const dt = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6])
  );
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Devuelve { captureTime, focal, aperture, iso, exposureTime, source }.
// captureTime es epoch ms de DateTimeOriginal (preferido) o DateTime; null si no hay EXIF.
export function readCaptureTimeFromBytes(bytes) {
  let tiffStart = findExifStart(bytes);
  if (tiffStart < 0) tiffStart = findTiffStart(bytes); // CR3: EXIF sin firma "Exif\0\0"
  if (tiffStart < 0 || tiffStart + 8 > bytes.length) {
    return { captureTime: null, focal: null, aperture: null, iso: null, exposureTime: null, source: "none" };
  }
  const little = bytes[tiffStart] === 0x49; // "II" little-endian
  if (readU16(bytes, tiffStart + 2, little) !== 0x2a) {
    return { captureTime: null, focal: null, aperture: null, iso: null, exposureTime: null, source: "none" };
  }
  const ifd0Offset = readU32(bytes, tiffStart + 4, little);
  const ifd0 = readIfdEntries(bytes, tiffStart, ifd0Offset, little);

  const exifPtr = findTag(ifd0, 0x8769);
  const exifIfd = exifPtr ? readIfdEntries(bytes, tiffStart, readU32(bytes, exifPtr.valueOffset, little), little) : [];

  const dto = findTag(exifIfd, 0x9003); // DateTimeOriginal
  const dt = findTag(ifd0, 0x0132);     // DateTime
  const captureTime = parseExifDate(dto ? readAscii(bytes, dto) : "") || parseExifDate(dt ? readAscii(bytes, dt) : "");

  const focalEntry = findTag(exifIfd, 0x920a);
  const fnumEntry = findTag(exifIfd, 0x829d);
  const expEntry = findTag(exifIfd, 0x829a);
  const isoEntry = findTag(exifIfd, 0x8827);

  return {
    captureTime,
    focal: focalEntry ? Math.round(readRational(bytes, focalEntry, little)) : null,
    aperture: fnumEntry ? Math.round(readRational(bytes, fnumEntry, little) * 10) / 10 : null,
    iso: isoEntry ? readShort(bytes, isoEntry, little) : null,
    exposureTime: expEntry ? readRational(bytes, expEntry, little) : null,
    source: captureTime != null ? "exif" : "none",
  };
}

export async function readCaptureTime(file) {
  const buffer = await file.arrayBuffer();
  return readCaptureTimeFromBytes(new Uint8Array(buffer));
}