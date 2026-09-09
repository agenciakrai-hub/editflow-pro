// EditFlow V2 — ingesta local. El RAW se lee en el navegador y nunca se envía.
import { extractRawPreview, isHiddenOrSystemFile, isRawFile, placeholderPreview } from "@/lib/rawaistudio/rawPreviewReader";
import { computePHash } from "@/lib/rawaistudio/perceptualHash";
import { readCaptureTimeFromBytes } from "@/lib/rawaistudio/captureTime";

export async function readLocalFolder(handle, onProgress) {
  const files = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "file" && isRawFile(name) && !isHiddenOrSystemFile(name)) files.push(await entry.getFile());
  }
  const output = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    let bytes = null;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch {}
    let preview;
    try { preview = await extractRawPreview(file, 720, { bytes: bytes || undefined }); }
    catch { preview = placeholderPreview(); }
    let capture = {};
    try { capture = bytes ? readCaptureTimeFromBytes(bytes) : {}; } catch {}
    const phash = preview?.dataUrl && !preview.isPlaceholder ? await computePHash(preview.dataUrl) : null;
    output.push({
      id: `v2-photo-${index + 1}`,
      file,
      preview,
      phash,
      captureTime: capture?.captureTime ?? file.lastModified,
      technical: {
        corrupt: !preview || preview.isPlaceholder,
        sharpness: preview?.sharpness ?? null,
        exposure: preview?.exposureScore ?? null,
      },
    });
    onProgress?.(index + 1, files.length);
  }
  return output;
}
