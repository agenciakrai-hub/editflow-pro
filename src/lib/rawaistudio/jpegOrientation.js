// El navegador aplica EXIF automáticamente. Normalizar SOLO la copia del JPEG
// de preview antes de decodificarla; después el lector aplica el giro RAW una vez.
export function normalizeJpegOrientation(bytes) {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let pos = 2;
  while (pos + 4 <= copy.length && copy[pos] === 255) {
    const marker = copy[pos + 1];
    if (marker === 218 || marker === 217) break;
    const size = view.getUint16(pos + 2, false);
    const end = pos + 2 + size;
    if (size < 2 || end > copy.length) break;
    if (marker === 225 && size >= 16 && String.fromCharCode(...copy.slice(pos + 4, pos + 10)) === 'Exif\0\0') {
      const tiff = pos + 10;
      const little = copy[tiff] === 73 && copy[tiff + 1] === 73;
      const big = copy[tiff] === 77 && copy[tiff + 1] === 77;
      if ((little || big) && tiff + 8 <= end) {
        const ifd = tiff + view.getUint32(tiff + 4, little);
        if (ifd >= tiff && ifd + 2 <= end) {
          const count = view.getUint16(ifd, little);
          for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (entry + 12 > end) break;
            if (view.getUint16(entry, little) === 274 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) view.setUint16(entry + 8, 1, little);
          }
        }
      }
    }
    pos = end;
  }
  return copy;
}
