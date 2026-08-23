// Client-side XMP sidecar generation + download for the local workflow.
// Temperature is absolute Kelvin (Lightroom crs:Temperature): defaults to 5500K
// (daylight) when no preset color was applied; when a .xmp preset was uploaded,
// temperature is already absolute Kelvin and is emitted as-is.
import { toXmpName } from "@/lib/xmp/XmpExportEngine.js";

function num(v, f = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}

function temperatureKelvin(a) {
  const t = num(a.temperature, 5500);
  return t > 200 ? Math.round(t) : 5500;
}

export function buildLocalXmp(name, a = {}) {
  const temperature = temperatureKelvin(a);
  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="EditFlow Pro">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
      <crs:AlreadyApplied>False</crs:AlreadyApplied>
      <crs:Version>15.0</crs:Version>
      <crs:ProcessVersion>15.0</crs:ProcessVersion>
      <crs:Exposure2012>${num(a.exposure)}</crs:Exposure2012>
      <crs:Contrast2012>${num(a.contrast)}</crs:Contrast2012>
      <crs:Highlights2012>${num(a.highlights)}</crs:Highlights2012>
      <crs:Shadows2012>${num(a.shadows)}</crs:Shadows2012>
      <crs:Whites2012>${num(a.whites)}</crs:Whites2012>
      <crs:Blacks2012>${num(a.blacks)}</crs:Blacks2012>
      <crs:Temperature>${temperature}</crs:Temperature>
      <crs:Tint>${num(a.tint)}</crs:Tint>
      <crs:Vibrance>${num(a.vibrance)}</crs:Vibrance>
      <crs:Saturation>${num(a.saturation)}</crs:Saturation>
      <crs:Sharpness>${num(a.sharpness)}</crs:Sharpness>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}

export function downloadXmp(name, adjustments) {
  const xmp = buildLocalXmp(name, adjustments);
  const blob = new Blob([xmp], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = toXmpName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadAllXmp(photos) {
  for (const p of photos) {
    downloadXmp(p.name, p.adjustments);
    await new Promise((r) => setTimeout(r, 300));
  }
}