// Ver src/lib/rawaistudio/cameraMetadata.js — misma lista, versión backend. La info de
// cámara (make/modelo) ya se calcula en el navegador durante la subida (necesita leer el
// RAW local) y se guarda en Image.processing_result.metadata.cameraInfo; el backend solo
// necesita esta función para resolver la marca a partir de esa info ya extraída.
const BRAND_KEYWORDS = ["Canon", "Leica", "Nikon", "Sony", "Fujifilm", "Fuji", "Panasonic", "Olympus", "Pentax", "Hasselblad", "Phase One"];

export function brandFromMake(make: string) {
  const m = (make || "").toLowerCase();
  return BRAND_KEYWORDS.find((b) => m.includes(b.toLowerCase())) || (make || "Desconocida");
}