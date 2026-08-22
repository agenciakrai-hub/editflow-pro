// XmpPatchTest — prototipo INDEPENDIENTE.
//
// Parsea el XMP como XML SÓLO para localizar los nodos de revelado (no para
// re-serializar). A partir del nodo encontrado construye la subcadena exacta
// `<prefijo:Tag>valorActual</prefijo:Tag>` y la reemplaza por
// `<prefijo:Tag>nuevoValor</prefijo:Tag>` en el texto original. Como las etiquetas
// de apertura/cierre son idénticas en ambos, solo cambian los bytes del valor:
// el resto del archivo queda byte a byte idéntico. No usa XMLSerializer ni regex.

export const TEST_VALUES = {
  Exposure2012: "+1.00",
  Contrast2012: "40",
  Highlights2012: "-70",
  Shadows2012: "60",
  Whites2012: "20",
  Blacks2012: "-20",
  Temperature: "6000",
  Tint: "10",
  Vibrance: "30",
  Saturation: "5",
  Sharpness: "70",
};

export function patchXmp(xmpText) {
  const doc = new DOMParser().parseFromString(xmpText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("El archivo no es un XML válido.");
  }

  let raw = xmpText;
  const patched = [];
  const missing = [];

  for (const tag of Object.keys(TEST_VALUES)) {
    // Localiza el nodo por localName (ignora el prefijo del namespace).
    let node = null;
    for (const el of doc.getElementsByTagName("*")) {
      if (el.localName === tag) { node = el; break; }
    }
    if (!node) { missing.push(tag); continue; }

    // Subcadena exacta del elemento tal como aparece en el original.
    const open = `<${node.nodeName}>`;
    const close = `</${node.nodeName}>`;
    const target = `${open}${node.textContent}${close}`;
    const replacement = `${open}${TEST_VALUES[tag]}${close}`;

    // Si el nodo tenía atributos o estaba auto-cerrado, no aparece literalmente
    // así; en ese caso lo dejamos intacto (no corrompemos el archivo).
    if (raw.indexOf(target) === -1) { missing.push(tag); continue; }

    raw = raw.replace(target, replacement); // primera ocurrencia literal
    patched.push(tag);
  }

  return { text: raw, patched, missing };
}

// nombre.xmp -> nombre_modificado.xmp
export const toModifiedName = (filename) => {
  const base = (filename || "archivo").replace(/\.[^.]+$/, "");
  return `${base}_modificado.xmp`;
};