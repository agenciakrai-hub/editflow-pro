// Lee el paquete XMP incrustado en el tag TIFF 700 (IFD0) de una copia de DNG ya procesada
// por el motor local (ver src/lib/rawaistudio/dngXmpEmbedder.js, del que esta lógica es un
// puerto exacto a Deno). Se usa para poder empaquetar solo el XMP (unos KB) en el ZIP final
// en vez del DNG completo (decenas de MB), sin volver a tocar ni reprocesar ninguna foto.
const XMP_TAG = 0x02bc; // 700

const readU16 = (b: Uint8Array, o: number, le: boolean) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
const readU32 = (b: Uint8Array, o: number, le: boolean) =>
  le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

function findXmpEntryInIfd0(bytes: Uint8Array) {
  if (bytes.length < 8) return null;
  const isLE = bytes[0] === 0x49 && bytes[1] === 0x49;
  const isBE = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!isLE && !isBE) return null;
  const little = isLE;
  if (readU16(bytes, 2, little) !== 0x2a) return null;

  const ifd0Offset = readU32(bytes, 4, little);
  if (ifd0Offset <= 0 || ifd0Offset + 2 > bytes.length) return null;
  const count = readU16(bytes, ifd0Offset, little);

  for (let i = 0; i < count; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;
    const tag = readU16(bytes, entryOffset, little);
    if (tag !== XMP_TAG) continue;
    const type = readU16(bytes, entryOffset + 2, little);
    const num = readU32(bytes, entryOffset + 4, little);
    const unitSize = TYPE_SIZE[type] || 1;
    const byteLength = unitSize * num;
    const valueOffset = byteLength > 4 ? readU32(bytes, entryOffset + 8, little) : entryOffset + 8;
    if (valueOffset + byteLength > bytes.length) return null;
    return { valueOffset, byteLength };
  }
  return null;
}

// Devuelve el texto XMP incrustado, o null si el DNG no tiene entrada de tag 700 legible.
export function readEmbeddedXmpText(bytes: Uint8Array): string | null {
  const entry = findXmpEntryInIfd0(bytes);
  if (!entry) return null;
  const raw = bytes.slice(entry.valueOffset, entry.valueOffset + entry.byteLength);
  return new TextDecoder().decode(raw).replace(/\0+$/, '').trimEnd();
}