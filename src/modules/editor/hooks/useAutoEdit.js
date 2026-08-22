// Hook that auto-computes the 13 basic adjustments for selected photos using the
// wedding-raw-ai exposure engine. Self-contained to the editor module.
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { computeAutoAdjustments } from "../utils/exposureEngine.js";

export function useAutoEdit() {
  const [photos, setPhotos] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Preset.list("-updated_date", 50),
      base44.entities.Photo.filter({ culling_status: "selected" }),
    ]).then(([pr, ph]) => {
      setPresets(pr);
      setPhotos(ph);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const autoEditOne = async (photo) => {
    setComputing(true);
    const adjustments = await computeAutoAdjustments(photo);
    await base44.entities.Photo.update(photo.id, { adjustments, edit_applied: true });
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, adjustments, edit_applied: true } : p)));
    setComputing(false);
    return adjustments;
  };

  return { photos, presets, loading, computing, setPhotos, autoEditOne };
}