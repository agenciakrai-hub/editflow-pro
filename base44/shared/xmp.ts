// Shared XMP sidecar generator (Editkrfoto structure, ported Python -> TS).
// Writes Adobe Camera Raw crs: attributes from the adjustment values computed
// by the wedding-raw-ai editor module. Used by the editflow-engine function.

function num(v) {
  const n = typeof v === "number" && isFinite(v) ? v : 0;
  return String(Math.round(n * 100) / 100);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateXMP(adjustments, filename, cameraProfile) {
  const a = adjustments || {};
  const crs = [
    `crs:Exposure2012="${num(a.exposure)}"`,
    `crs:Contrast2012="${num(a.contrast)}"`,
    `crs:Highlights2012="${num(a.highlights)}"`,
    `crs:Shadows2012="${num(a.shadows)}"`,
    `crs:Whites2012="${num(a.whites)}"`,
    `crs:Blacks2012="${num(a.blacks)}"`,
    `crs:Temperature="${num(a.temperature)}"`,
    `crs:Tint="${num(a.tint)}"`,
    `crs:Vibrance="${num(a.vibrance)}"`,
    `crs:Saturation="${num(a.saturation)}"`,
    `crs:Clarity2012="${num(a.clarity)}"`,
    `crs:Sharpness="${num(a.sharpness)}"`,
    `crs:CameraProfile="${esc(cameraProfile || "Adobe Standard")}"`,
    `crs:ProcessVersion="11.0"`,
  ].join("\n      ");

  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="${esc(filename)}"
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      ${crs}
    />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export const LEEME_TXT = `EditFlow Pro - Bundle XMP
==========================

Este ZIP contiene un archivo .xmp por foto con los ajustes de edición
calculados por el motor de EditFlow Pro (valores crs: de Adobe Camera Raw).

Instalacion en Lightroom Classic:
1. Descomprime este ZIP en una carpeta.
2. En Lightroom, selecciona las fotos en el modulo Biblioteca.
3. Menu > Metadatos > Guardar metadatos en archivo (no necesario si ya hay XMP).
4. Para APLICAR los ajustes: selecciona las fotos y arrastra el .xmp
   correspondiente sobre cada foto, o usa Metadatos > Importar metadatos
   desde archivo y selecciona la carpeta con los .xmp.

Cada archivo .xmp tiene el mismo nombre que la foto original, por lo que
Lightroom los emparejara automaticamente al importar.

Generado por EditFlow Pro.
`;