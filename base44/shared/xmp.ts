// Shared XMP sidecar generator (Adobe Camera Raw crs: attributes).
// Writes the full Lightroom Develop toolset computed by the editor module.
// Used by the editflow-engine function.

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

const HSL_COLORS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];
const HSL_MAP = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", aqua: "Aqua", blue: "Blue", purple: "Purple", magenta: "Magenta" };

function curveStr(points) {
  if (!Array.isArray(points) || !points.length) return "0, 0; 255, 255";
  return points.map((p) => `${p[0]}, ${p[1]}`).join("; ");
}

export function generateXMP(adjustments, filename, cameraProfile) {
  const a = adjustments || {};
  const crop = a.crop || {};
  const hsl = a.hsl || {};
  const grading = a.grading || {};
  const curve = a.curve || {};

  const crs = [
    `crs:Version="13.0"`,
    `crs:ProcessVersion="11.0"`,
    `crs:CameraProfile="${esc(a.cameraProfile || cameraProfile || "Adobe Standard")}"`,
    // Luz
    `crs:Exposure2012="${num(a.exposure)}"`,
    `crs:Contrast2012="${num(a.contrast)}"`,
    `crs:Highlights2012="${num(a.highlights)}"`,
    `crs:Shadows2012="${num(a.shadows)}"`,
    `crs:Whites2012="${num(a.whites)}"`,
    `crs:Blacks2012="${num(a.blacks)}"`,
    // Color
    `crs:Temperature="${num(a.temperature)}"`,
    `crs:Tint="${num(a.tint)}"`,
    `crs:Vibrance="${num(a.vibrance)}"`,
    `crs:Saturation="${num(a.saturation)}"`,
    // Presencia
    `crs:Texture="${num(a.texture)}"`,
    `crs:Clarity2012="${num(a.clarity)}"`,
    `crs:Dehaze="${num(a.dehaze)}"`,
    // Curva de tonos
    `crs:ToneCurvePV2012="${esc(curveStr(curve.rgb))}"`,
    `crs:ToneCurvePV2012Red="${esc(curveStr(curve.red))}"`,
    `crs:ToneCurvePV2012Green="${esc(curveStr(curve.green))}"`,
    `crs:ToneCurvePV2012Blue="${esc(curveStr(curve.blue))}"`,
  ];

  // Mezclador de color (HSL)
  for (const [k, name] of Object.entries(HSL_MAP)) {
    const c = hsl[k] || {};
    crs.push(`crs:HueAdjustment${name}="${num(c.h)}"`);
    crs.push(`crs:SaturationAdjustment${name}="${num(c.s)}"`);
    crs.push(`crs:LuminanceAdjustment${name}="${num(c.l)}"`);
  }

  // Calibración de color (split toning / color grading)
  crs.push(
    `crs:SplitToningShadowHue="${num(grading.shadowsHue)}"`,
    `crs:SplitToningShadowSaturation="${num(grading.shadowsSat)}"`,
    `crs:ColorGradeMidtoneHue="${num(grading.midtonesHue)}"`,
    `crs:ColorGradeMidtoneSaturation="${num(grading.midtonesSat)}"`,
    `crs:SplitToningHighlightHue="${num(grading.highlightsHue)}"`,
    `crs:SplitToningHighlightSaturation="${num(grading.highlightsSat)}"`,
    `crs:ColorGradeBlending="${num(grading.blending)}"`,
    `crs:SplitToningBalance="${num(grading.balance)}"`,
  );

  // Detalle
  crs.push(
    `crs:Sharpness="${num(a.sharpness)}"`,
    `crs:SharpnessRadius="${num(a.sharpRadius)}"`,
    `crs:SharpnessDetail="${num(a.sharpDetail)}"`,
    `crs:SharpnessMasking="${num(a.sharpMasking)}"`,
    `crs:LuminanceSmoothing="${num(a.noiseLuminance)}"`,
    `crs:LuminanceNoiseReductionDetail="${num(a.noiseLumDetail)}"`,
    `crs:LuminanceNoiseReductionContrast="${num(a.noiseContrast)}"`,
    `crs:ColorNoiseReduction="${num(a.colorNoise)}"`,
    `crs:ColorNoiseReductionDetail="${num(a.colorDetail)}"`,
    `crs:ColorNoiseReductionSmoothness="${num(a.colorSmoothness)}"`,
  );

  // Correcciones de lente
  crs.push(
    `crs:LensManualDistortionAmount="${num(a.distortion)}"`,
    `crs:ChromaticAberration="${num(a.chromaticAb)}"`,
    `crs:DefringePurpleAmount="${num(a.defringePurple)}"`,
    `crs:DefringeGreenAmount="${num(a.defringeGreen)}"`,
    `crs:VignetteAmount="${num(a.lensVignette)}"`,
    `crs:VignetteMidpoint="${num(a.lensVignetteMid)}"`,
  );

  // Transformar
  crs.push(
    `crs:PerspectiveVertical="${num(a.transformVertical)}"`,
    `crs:PerspectiveHorizontal="${num(a.transformHorizontal)}"`,
    `crs:PerspectiveRotate="${num(a.transformRotate)}"`,
    `crs:PerspectiveScale="${num(a.transformScale)}"`,
    `crs:PerspectiveAspect="${num(a.transformAspect)}"`,
    `crs:PerspectiveX="${num(a.transformOffsetX)}"`,
    `crs:PerspectiveY="${num(a.transformOffsetY)}"`,
  );

  // Efectos
  crs.push(
    `crs:PostCropVignetteAmount="${num(a.pcvAmount)}"`,
    `crs:PostCropVignetteMidpoint="${num(a.pcvMidpoint)}"`,
    `crs:PostCropVignetteRoundness="${num(a.pcvRoundness)}"`,
    `crs:PostCropVignetteFeather="${num(a.pcvFeather)}"`,
    `crs:PostCropVignetteHighlight="${num(a.pcvHighlights)}"`,
    `crs:GrainAmount="${num(a.grainAmount)}"`,
    `crs:GrainSize="${num(a.grainSize)}"`,
    `crs:GrainRoughness="${num(a.grainRoughness)}"`,
  );

  // Calibración de cámara
  crs.push(
    `crs:ShadowTint="${num(a.shadowTint)}"`,
    `crs:RedHue="${num(a.redHue)}"`,
    `crs:RedSaturation="${num(a.redSaturation)}"`,
    `crs:GreenHue="${num(a.greenHue)}"`,
    `crs:GreenSaturation="${num(a.greenSaturation)}"`,
    `crs:BlueHue="${num(a.blueHue)}"`,
    `crs:BlueSaturation="${num(a.blueSaturation)}"`,
  );

  // Recortar y enderezar
  crs.push(
    `crs:CropAngle="${num(crop.angle)}"`,
    `crs:CropTop="${num(crop.top / 100)}"`,
    `crs:CropBottom="${num(crop.bottom / 100)}"`,
    `crs:CropLeft="${num(crop.left / 100)}"`,
    `crs:CropRight="${num(crop.right / 100)}"`,
  );

  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="${esc(filename)}"
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      ${crs.join("\n      ")}
    />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export const LEEME_TXT = `EditFlow Pro - Bundle XMP
==========================

Este ZIP contiene un archivo .xmp por foto con TODOS los ajustes de edición
calculados por el motor de EditFlow Pro (valores crs: de Adobe Camera Raw):
luz, color, presencia, curva de tonos, mezclador de color (HSL), calibracion
de color, detalle, correcciones de lente, transformar, efectos, calibracion
de camara y recorte.

Instalacion en Lightroom Classic:
1. Descomprime este ZIP en una carpeta.
2. En Lightroom, selecciona las fotos en el modulo Biblioteca.
3. Para APLICAR los ajustes: selecciona las fotos y arrastra el .xmp
   correspondiente sobre cada foto, o usa Metadatos > Importar metadatos
   desde archivo y selecciona la carpeta con los .xmp.

Cada archivo .xmp tiene el mismo nombre que la foto original, por lo que
Lightroom los emparejara automaticamente al importar.

Generado por EditFlow Pro.
`;