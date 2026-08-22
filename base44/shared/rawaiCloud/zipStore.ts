// Puerto directo de src/lib/zip/zipStore.js para el backend (Deno) — mismo escritor ZIP
// mínimo sin compresión (STORE), sin ninguna dependencia del navegador (solo
// ArrayBuffer/Uint8Array/DataView/Blob, disponibles también en Deno).

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function buildZip(entries: { name: string; data: Uint8Array }[]) {
  const enc = new TextEncoder();
  const chunks: (Uint8Array)[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const time = 0;
  const date = (2024 - 1980) * 512 + 1;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lh = new DataView(local.buffer);
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    chunks.push(local, entry.data);
    central.push(cd);
    offset += local.length + entry.data.length;
  }

  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const cdOffset = offset;

  const end = new Uint8Array(22);
  const ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(4, 0, true);
  ed.setUint16(6, 0, true);
  ed.setUint16(8, entries.length, true);
  ed.setUint16(10, entries.length, true);
  ed.setUint32(12, cdSize, true);
  ed.setUint32(16, cdOffset, true);
  ed.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

// --- Ampliación incremental ------------------------------------------------------------
// Un ZIP "store" (sin compresión) es, hasta su directorio central, solo una concatenación
// de bloques independientes (header + datos) por entrada. Eso permite AÑADIR entradas
// nuevas a un ZIP ya construido reutilizando esos bloques tal cual (sin volver a descargar
// ni recomprimir los XMP que ya contenía) y reescribiendo únicamente el directorio central
// — que no necesita los datos originales, solo su nombre/CRC/tamaño/offset, leídos del
// directorio central antiguo. Así, empaquetar 5.000 fotos por lotes de 15 cuesta lo mismo
// en total que construir el ZIP una sola vez al final, en vez de re-descargar todo en cada
// lote.

interface ZipEntryInfo { name: string; crc: number; size: number; offset: number }

function findEocd(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return { view, offset: i };
  }
  throw new Error("ZIP inválido: no se encontró el directorio central (end of central directory)");
}

export function parseZipEntries(bytes: Uint8Array): { entries: ZipEntryInfo[]; cdOffset: number } {
  const { view, offset: eocdOffset } = findEocd(bytes);
  const count = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const dec = new TextDecoder();
  const entries: ZipEntryInfo[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP inválido: directorio central corrupto");
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.slice(p + 46, p + 46 + nameLen));
    entries.push({ name, crc, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, cdOffset };
}

export function appendZip(existingZip: Uint8Array, newEntries: { name: string; data: Uint8Array }[]) {
  const { entries: oldEntries, cdOffset } = parseZipEntries(existingZip);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [existingZip.slice(0, cdOffset)]; // bloques locales ya existentes, sin tocar
  const central: Uint8Array[] = [];
  let offset = cdOffset;
  const time = 0;
  const date = (2024 - 1980) * 512 + 1;

  const writeCentral = (name: string, crc: number, size: number, entryOffset: number) => {
    const nameBytes = enc.encode(name);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, entryOffset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
  };

  for (const e of oldEntries) writeCentral(e.name, e.crc, e.size, e.offset);

  for (const entry of newEntries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const local = new Uint8Array(30 + nameBytes.length);
    const lh = new DataView(local.buffer);
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    chunks.push(local, entry.data);
    writeCentral(entry.name, crc, size, offset);
    offset += local.length + entry.data.length;
  }

  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const newCdOffset = offset;
  const totalEntries = oldEntries.length + newEntries.length;

  const end = new Uint8Array(22);
  const ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, totalEntries, true);
  ed.setUint16(10, totalEntries, true);
  ed.setUint32(12, cdSize, true);
  ed.setUint32(16, newCdOffset, true);

  return { blob: new Blob([...chunks, ...central, end], { type: "application/zip" }), totalEntries };
}