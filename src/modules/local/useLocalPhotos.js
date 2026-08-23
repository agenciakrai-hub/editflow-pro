// Local (no-DB) photo workflow hook. Reads RAW files selected from disk, extracts
// their embedded preview entirely in the browser, and keeps an in-memory list with
// culling + adjustment state. No bytes ever leave the machine except the small
// preview base64 sent to the IA backend for technical analysis.
import { useState, useCallback } from "react";
import {
  extractRawPreview,
  placeholderPreview,
  isRawFile,
  isHiddenOrSystemFile,
} from "@/lib/rawaistudio/rawPreviewReader.js";

export function useLocalPhotos() {
  const [photos, setPhotos] = useState([]);
  const [processing, setProcessing] = useState(false);

  const addFiles = useCallback(async (fileList) => {
    const raws = Array.from(fileList).filter(
      (f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name)
    );
    if (!raws.length) return;
    setProcessing(true);
    const items = [];
    for (const file of raws) {
      let preview;
      try {
        preview = await extractRawPreview(file, 800);
      } catch {
        preview = placeholderPreview();
      }
      items.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        name: file.name,
        previewUrl: preview.dataUrl,
        base64: preview.base64,
        sharpness: preview.sharpness,
        exposureScore: preview.exposureScore,
        status: "unreviewed",
        adjustments: {},
        edit_applied: false,
        computing: false,
      });
    }
    setPhotos((prev) => [...prev, ...items]);
    setProcessing(false);
  }, []);

  const setStatus = useCallback((id, status) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
  }, []);

  const remove = useCallback((id) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const clear = useCallback(() => setPhotos([]), []);

  return { photos, processing, addFiles, setStatus, remove, clear, setPhotos };
}