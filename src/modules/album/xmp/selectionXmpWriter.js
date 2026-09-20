// MAQUETAR DESDE JPG — Generador de sidecars XMP para la clasificación de
// Selección IA. Produce archivos .xmp compatibles con Lightroom que contienen
// ÚNICAMENTE xmp:Rating y xmp:Label (sin ajustes de revelado crs:*): Lightroom
// los lee como metadatos de selección, no como preset de develop.
//
// Formato generado (ejemplo para FOTO TOP):
//   <?xml version="1.0" encoding="UTF-8"?>
//   <x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="EditFlow Pro Album AI">
//     <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
//       <rdf:Description rdf:about=""
//         xmlns:xmp="http://ns.adobe.com/xap/1.0/"
//         xmp:Rating="5"
//         xmp:Label="Verde">
//       </rdf:Description>
//     </rdf:RDF>
//   </x:xmpmeta>
//   <?xpacket end="w"?>
//
// Etiquetas en español (Lightroom las reconoce por valor literal):
//   Verde, Amarillo, Rojo, Azul, Púrpura.

const XMP_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="EditFlow Pro Album AI">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

// Construye el texto XMP de un sidecar de selección con Rating + Label.
// rating=0 → no se escribe xmp:Rating (sin estrellas). label="" → no se escribe.
export function buildSelectionXmp({ rating, label }) {
  let xmp = XMP_BASE;
  const opening = /<rdf:Description rdf:about=""/;
  if (rating != null && rating > 0) {
    xmp = xmp.replace(opening, `<rdf:Description rdf:about="" xmp:Rating="${rating}"`);
  }
  if (label) {
    xmp = xmp.replace(opening, `<rdf:Description rdf:about="" xmp:Label="${label}"`);
  }
  return xmp;
}

// Nombre del sidecar: mismo base name que la foto + extensión .xmp.
// "IMG_0001.CR2" → "IMG_0001.xmp"
export function xmpSidecarName(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base + ".xmp";
}