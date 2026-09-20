// MAQUETAR DESDE JPG — Lector de metadatos XMP embebidos en archivos JPG.
// Lee localmente (File.arrayBuffer) el segmento APP1 de Adobe XMP y extrae
// xmp:Rating y xmp:Label. Ningún byte sale del navegador. Compatible con JPGs
// exportados por Lightroom (que embeben el XMP en el APP1 estándar de Adobe).
//
// Formato del segmento APP1/XMP en un JPG:
//   FF D8                     SOI
//   FF E1 LL LL              APP1 marker + length (big-endian)
//   "http://ns.adobe.com/xap/1.0/\0"  namespace (29 bytes)
//   <XMP packet XML>          datos XMP hasta el final del segmento
//
// xmp:Rating y xmp:Label pueden aparecer como ATRIBUTO (xmp:Rating="5") o como
// ELEMENTO HIJO (<xmp:Rating>5</xmp:Rating>); se prueban ambos (Lightroom y
// otros escritores usan formas distintas).

const XMP_NS = "http://ns.adobe.com/xap/1.0/";

// Lee el XMP embebido de un JPG File y devuelve { rating, label, raw }.
// rating=0 y label="" si no hay XMP o no se encuentran los campos.
export async function readJpgXmp(file) {
  let buf;
  try { buf = await file.arrayBuffer(); } catch { return { rating: 0, label: "", raw: null }; }
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { rating: 0, label: "", raw: null };

  let pos = 2; // saltar SOI
  while (pos < bytes.length - 4) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xe1) {
      // APP1 — comprobar si es XMP
      const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
      const nsStart = pos + 4;
      const nsEnd = nsStart + XMP_NS.length;
      if (nsEnd <= bytes.length) {
        let ns = "";
        for (let i = nsStart; i < nsEnd; i++) ns += String.fromCharCode(bytes[i]);
        if (ns.startsWith(XMP_NS)) {
          // XMP data empieza tras el namespace (29 bytes incluyendo \0)
          const xmpStart = nsStart + 29;
          const xmpEnd = Math.min(pos + 2 + segLen, bytes.length);
          let xmpText = "";
          for (let i = xmpStart; i < xmpEnd; i++) xmpText += String.fromCharCode(bytes[i]);
          return parseXmpRatingLabel(xmpText);
        }
      }
      pos += 2 + segLen;
    } else if (marker === 0xda) {
      break; // SOS — datos de imagen, no más APP markers
    } else if (marker >= 0xd0 && marker <= 0xd7) {
      pos += 2; // RST markers sin longitud
    } else if (marker === 0xd9) {
      break; // EOI
    } else {
      const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 2 + segLen;
    }
  }
  return { rating: 0, label: "", raw: null };
}

// Parsea xmp:Rating y xmp:Label de un texto XMP (atributo o elemento hijo).
function parseXmpRatingLabel(xmpText) {
  let rating = 0;
  let label = "";
  // Rating: atributo primero, luego elemento hijo
  const ratingAttr = /xmp:Rating\s*=\s*"(\d+)"/.exec(xmpText);
  if (ratingAttr) rating = parseInt(ratingAttr[1], 10);
  else {
    const ratingChild = /<xmp:Rating>\s*(\d+)\s*<\/xmp:Rating>/.exec(xmpText);
    if (ratingChild) rating = parseInt(ratingChild[1], 10);
  }
  // Label: atributo primero, luego elemento hijo
  const labelAttr = /xmp:Label\s*=\s*"([^"]*)"/.exec(xmpText);
  if (labelAttr) label = labelAttr[1].trim();
  else {
    const labelChild = /<xmp:Label>\s*([^<]*)\s*<\/xmp:Label>/.exec(xmpText);
    if (labelChild) label = labelChild[1].trim();
  }
  return { rating, label, raw: xmpText };
}