// SELECCIÓN IA — Exportación de sidecars XMP con la clasificación de cada foto.
// Genera un ZIP con un .xmp por foto (mismo base name) que Lightroom importa como
// metadatos de selección (xmp:Rating + xmp:Label). El fotógrafo los coloca junto
// a sus RAW, importa a Lightroom y la clasificación viaja con los JPG editados.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { createZip } from "@/lib/miniZip";
import { buildSelectionXmp, xmpSidecarName } from "@/modules/album/xmp/selectionXmpWriter";
import { classificationForRole, xmpForClassification } from "@/modules/album/xmp/classificationMapper";

// selection: [{ photo_id, role }] — de AlbumAISelection.selection
// photos: [AlbumPhoto] — catálogo del proyecto (para obtener filenames)
// Exporta un ZIP con sidecars .xmp para cada foto clasificada (TOP/VALID/REVIEW).
export function downloadSelectionXmpZip(selection, photos, projectName = "album") {
  const byId = new Map(photos.map((p) => [p.id, p]));
  const files = [];
  for (const s of selection || []) {
    const photo = byId.get(s.photo_id);
    if (!photo?.filename) continue;
    const classification = classificationForRole(s.role, photo.ai_state);
    if (!classification) continue;
    const xmpVals = xmpForClassification(classification);
    if (!xmpVals) continue;
    const xmpText = buildSelectionXmp(xmpVals);
    files.push({ name: xmpSidecarName(photo.filename), data: new TextEncoder().encode(xmpText) });
  }
  if (!files.length) return;
  const blob = createZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `seleccion-xmp-${projectName.replace(/\s+/g, "-").toLowerCase()}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function SelectionXmpExport({ selection, photos, projectName, disabled }) {
  const [exporting, setExporting] = useState(false);
  const count = (selection || []).filter((s) => classificationForRole(s.role)).length;

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadSelectionXmpZip(selection, photos, projectName);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={disabled || exporting || count === 0} variant="outline" className="gap-2">
      {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Exportar XMP ({count})
    </Button>
  );
}