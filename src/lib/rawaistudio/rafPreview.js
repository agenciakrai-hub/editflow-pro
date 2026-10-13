// La cabecera RAF declara la posición y longitud del JPEG; no escanear datos del sensor.
export function extractRafJpeg(bytes) {
  if (bytes.length < 92) return null;
  const signature = 'FUJIFILMCCD-RAW ';
  if (![...signature].every((char, i) => bytes[i] === char.charCodeAt(0))) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32(84, false);
  const length = view.getUint32(88, false);
  if (offset < 92 || length < 4 || offset + length > bytes.length) throw new Error('Cabecera RAF: vista previa fuera de los límites del archivo');
  if (bytes[offset] !== 0xff || bytes[offset + 1] !== 0xd8 || bytes[offset + length - 2] !== 0xff || bytes[offset + length - 1] !== 0xd9) throw new Error('Vista previa JPEG del RAF incompleta');
  return bytes.slice(offset, offset + length);
}
