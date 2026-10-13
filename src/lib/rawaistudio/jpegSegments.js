// Recorrer marcadores JPEG: APP/Exif puede contener otra miniatura con SOI/EOI.
// Esos bytes son metadatos del JPEG exterior y nunca delimitan su imagen.
export function findEmbeddedJpegSegments(bytes) {
  const segments = [];
  for (let start = 0; start < bytes.length - 4; start++) {
    if (bytes[start] !== 255 || bytes[start + 1] !== 216) continue;
    let pos = start + 2, frame = false, scan = false, end = -1;
    while (pos < bytes.length - 1) {
      if (bytes[pos] !== 255) break;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 217) { if (frame && scan) end = pos; break; }
      if (marker === 216 || marker === 0) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (pos + 1 >= bytes.length) break;
      const size = bytes[pos] * 256 + bytes[pos + 1];
      if (size < 2 || pos + size > bytes.length) break;
      // JPEG lossless del sensor RAW no es una vista previa web decodificable.
      if ([192, 193, 194].includes(marker)) frame = true;
      pos += size;
      if (marker === 218) {
        scan = true;
        while (pos < bytes.length - 1) {
          if (bytes[pos] !== 255) { pos++; continue; }
          const next = bytes[pos + 1];
          if (next === 0 || (next >= 208 && next <= 215)) { pos += 2; continue; }
          break;
        }
      }
    }
    if (end > start) { segments.push(bytes.slice(start, end)); start = end - 1; }
  }
  return segments;
}
