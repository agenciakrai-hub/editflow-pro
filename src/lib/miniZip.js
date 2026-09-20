// ZIP mínimo (sin dependencias) para descargar sidecars XMP agrupados.
// Almacena sin compresión (STORE); los .xmp son texto pequeño y no merece
// deflate. Implementación CRC32 + local headers + central directory + EOCD.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name: string, data: Uint8Array }] → Blob (application/zip)
export function createZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    central.push({ nameBytes, crc, size: data.length, offset });
    chunks.push(local, data);
    offset += local.length + data.length;
  }

  const centralChunks = [];
  let centralSize = 0;
  for (const c of central) {
    const h = new Uint8Array(46 + c.nameBytes.length);
    const hv = new DataView(h.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 20, true);
    hv.setUint32(16, c.crc, true);
    hv.setUint32(20, c.size, true);
    hv.setUint32(24, c.size, true);
    hv.setUint16(28, c.nameBytes.length, true);
    hv.setUint32(42, c.offset, true);
    h.set(c.nameBytes, 46);
    centralChunks.push(h);
    centralSize += h.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...centralChunks, eocd], { type: "application/zip" });
}