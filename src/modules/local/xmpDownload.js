// Client-side XMP sidecar generation + download. Maps the editor's flat
// adjustment keys to the XmpExportEngine's recipe shape (sharpness -> sharpening)
// and triggers a download named to match the RAW (KRFC0056.CR3 -> KRFC0056.xmp).
import { buildXmp, toXmpName } from "@/lib/xmp/XmpExportEngine.js";

function recipeFromAdjustments(name, adjustments = {}) {
  return {
    raw_name: name,
    preset_data: {
      exposure: adjustments.exposure ?? 0,
      contrast: adjustments.contrast ?? 0,
      highlights: adjustments.highlights ?? 0,
      shadows: adjustments.shadows ?? 0,
      whites: adjustments.whites ?? 0,
      blacks: adjustments.blacks ?? 0,
      temperature: adjustments.temperature ?? 0,
      tint: adjustments.tint ?? 0,
      vibrance: adjustments.vibrance ?? 0,
      saturation: adjustments.saturation ?? 0,
      sharpening: adjustments.sharpness ?? 0,
    },
  };
}

export function downloadXmp(name, adjustments) {
  const xmp = buildXmp(recipeFromAdjustments(name, adjustments));
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