// Validate actual decoded pixels, including legacy cache entries without metadata.
import { decodePreviewImage } from "./previewDecodeCache";

export async function prepareSelectionPreview(preview, file, extract, decode = decodePreviewImage) {
  const candidates = preview?.isPlaceholder ? [] : [preview?.dataUrl || (preview?.base64 ? "data:image/jpeg;base64," + preview.base64 : null)];
  if (preview?.hiResDataUrl) candidates.push(preview.hiResDataUrl);
  async function validate(dataUrl) {
    if (!dataUrl || !/^data:image\//.test(dataUrl)) return null;
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    try {
      const image = await decode(base64);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!(width > 10 && height > 10)) return null;
      return { ...preview, dataUrl, base64, width, height, isPlaceholder: false };
    } catch { return null; }
  }
  for (const candidate of candidates) {
    const valid = await validate(candidate);
    if (valid) return valid;
  }
  // A reopened project's metadata object is not a readable original File.
  if (typeof file?.arrayBuffer === "function" && extract) {
    try {
      const repaired = await extract(file, 800, { hiResMaxEdge: 2400 });
      if (!repaired?.isPlaceholder) return await validate(repaired?.dataUrl);
    } catch { /* Keep the original and request an explicit preview repair. */ }
  }
  return null;
}
