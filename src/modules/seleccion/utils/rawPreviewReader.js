// RAW preview reader (wedding-raw-ai) — extracts the embedded JPEG preview
// from a RAW file (DNG/CR2/CR3/NEF) by scanning for a JPEG SOI marker, falling
// back to the file itself for standard images.

const RAW_EXT = /\.(dng|cr2|cr3|nef|arw|raf|orf|rw2)$/i;
const SOI = 0xffd8;

export function isRawFile(filename) {
  return RAW_EXT.test(filename || "");
}

export async function extractEmbeddedPreview(file) {
  if (!isRawFile(file.name)) {
    return URL.createObjectURL(file);
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === (SOI & 0xff)) {
      // find EOI (0xFFD9)
      for (let j = bytes.length - 2; j > i; j--) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          const jpeg = bytes.slice(i, j + 2);
          return URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
        }
      }
    }
  }
  // no embedded preview found — use the raw blob as a last resort
  return URL.createObjectURL(file);
}