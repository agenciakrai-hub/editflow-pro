// RAW AI Studio — extractor de preview para DNG que NO tienen un JPEG suelto detectable
// por escaneo de bytes en bruto (el caso de varios DNG de Leica). En vez de "si no
// encuentro FFD8...FFD9 en cualquier parte del archivo, no hay preview", se recorre la
// estructura real de IFDs del TIFF/DNG (IFD0, la cadena de IFDs siguientes y los SubIFDs
// del tag 0x014A, donde muchos DNG guardan su preview de tamaño medio) y se localiza la
// preview por los tags estándar que declaran su offset y tamaño exactos.
// Soporta dos formas de preview: JPEG comprimida (Compression 6/7) y miniatura sin
// comprimir (Compression 1, RGB o gris plano). Nunca lee ni toca los datos RAW del
// sensor ni escribe nada en el archivo — solo localiza y copia bytes existentes.

const readU16 = (bytes, o, little) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
const readU32 = (bytes, o, little) =>
  little
    ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
    : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;

const TAG = {
  Compression: 0x0103,
  ImageWidth: 0x0100,
  ImageLength: 0x0101,
  StripOffsets: 0x0111,
  SamplesPerPixel: 0x0115,
  StripByteCounts: 0x0117,
  JpegIFOffset: 0x0201,
  JpegIFByteCount: 0x0202,
  SubIFDs: 0x014a
};

function readEntryArray(bytes, entry, little) {
  const elemSize = entry.type === 3 ? 2 : 4;
  const readElem = entry.type === 3 ? readU16 : readU32;
  if (entry.count <= 1) return [entry.value];
  const arr = [];
  for (let i = 0; i < entry.count; i++) arr.push(readElem(bytes, entry.value + i * elemSize, little));
  return arr;
}

function readIfd(bytes, offset, little) {
  const numEntries = readU16(bytes, offset, little);
  const entries = {};
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = offset + 2 + i * 12;
    const tag = readU16(bytes, entryOffset, little);
    const type = readU16(bytes, entryOffset + 2, little);
    const count = readU32(bytes, entryOffset + 4, little);
    const valueOffset = entryOffset + 8;
    const value = type === 3 && count === 1 ? readU16(bytes, valueOffset, little) : readU32(bytes, valueOffset, little);
    entries[tag] = { value, count, type };
  }
  const nextIfdOffset = readU32(bytes, offset + 2 + numEntries * 12, little);
  return { entries, nextIfdOffset };
}

function extractJpegFromIfd(bytes, entries, little) {
  const compression = entries[TAG.Compression]?.value;
  if (compression !== 6 && compression !== 7) return null;

  let offset, length;
  if (entries[TAG.JpegIFOffset]) {
    offset = entries[TAG.JpegIFOffset].value;
    length = entries[TAG.JpegIFByteCount]?.value;
  } else if (entries[TAG.StripOffsets]) {
    const offsets = readEntryArray(bytes, entries[TAG.StripOffsets], little);
    const counts = entries[TAG.StripByteCounts] ? readEntryArray(bytes, entries[TAG.StripByteCounts], little) : [];
    offset = offsets[0];
    length = counts.reduce((a, b) => a + b, 0) || counts[0];
  }
  if (offset == null || !length || offset + length > bytes.length) return null;
  return { type: "jpeg", bytes: bytes.slice(offset, offset + length) };
}

function extractRgbThumbFromIfd(bytes, entries, little) {
  if (entries[TAG.Compression]?.value !== 1) return null;
  const width = entries[TAG.ImageWidth]?.value;
  const height = entries[TAG.ImageLength]?.value;
  const samplesPerPixel = entries[TAG.SamplesPerPixel]?.value || 1;
  if (!width || !height || width > 2048 || height > 2048) return null; // solo miniaturas, no la imagen principal

  const offsets = entries[TAG.StripOffsets] ? readEntryArray(bytes, entries[TAG.StripOffsets], little) : null;
  if (!offsets) return null;
  const offset = offsets[0];
  const length = width * height * samplesPerPixel;
  if (offset + length > bytes.length) return null;
  return { type: "rgb", width, height, samplesPerPixel, data: bytes.slice(offset, offset + length) };
}

// Recorre IFD0, su cadena de "próximo IFD" (donde suele estar la miniatura clásica) y los
// SubIFDs (donde muchos DNG guardan la preview mediana) buscando una preview usable.
// Prioriza la JPEG más grande encontrada; si no hay ninguna, cae a la miniatura sin
// comprimir más grande.
export function extractDngPreview(bytes) {
  if (bytes.length < 8 || (bytes[0] !== 0x49 && bytes[0] !== 0x4d)) return null; // no es TIFF/DNG
  const little = bytes[0] === 0x49;
  if (readU16(bytes, 2, little) !== 42) return null;

  const jpegCandidates = [];
  const rgbCandidates = [];
  const visited = new Set();
  const queue = [readU32(bytes, 4, little)];

  while (queue.length) {
    const offset = queue.shift();
    if (!offset || offset >= bytes.length - 2 || visited.has(offset)) continue;
    visited.add(offset);

    let ifd;
    try {
      ifd = readIfd(bytes, offset, little);
    } catch {
      continue;
    }

    const jpeg = extractJpegFromIfd(bytes, ifd.entries, little);
    if (jpeg) jpegCandidates.push(jpeg.bytes);
    else {
      const rgb = extractRgbThumbFromIfd(bytes, ifd.entries, little);
      if (rgb) rgbCandidates.push(rgb);
    }

    if (ifd.entries[TAG.SubIFDs]) queue.push(...readEntryArray(bytes, ifd.entries[TAG.SubIFDs], little));
    if (ifd.nextIfdOffset) queue.push(ifd.nextIfdOffset);
  }

  if (jpegCandidates.length) {
    const best = jpegCandidates.reduce((a, b) => (b.length > a.length ? b : a));
    return { type: "jpeg", bytes: best };
  }
  if (rgbCandidates.length) {
    return rgbCandidates.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  }
  return null;
}