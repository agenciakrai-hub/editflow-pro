// Automatic culling for the local workflow. Ranks photos by technical quality
// (sharpness + exposure) from the preview analysis and auto-marks the best as
// selected and the worst as rejected. Pure client-side, no heuristics about content.
export default function autoSelectPhotos(photos, { selectRatio = 0.4, rejectRatio = 0.2 } = {}) {
  if (!photos.length) return photos;
  const maxSharp = Math.max(...photos.map((p) => Number(p.sharpness) || 0), 1);
  const scored = photos.map((p) => ({
    id: p.id,
    score: ((Number(p.sharpness) || 0) / maxSharp) * 0.6 + ((Number(p.exposureScore) ?? 0.5) * 0.4),
  }));
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const selectCount = Math.max(1, Math.round(photos.length * selectRatio));
  const rejectCount = Math.round(photos.length * rejectRatio);
  const selectedIds = new Set(ranked.slice(0, selectCount).map((s) => s.id));
  const rejectedIds = new Set(ranked.slice(ranked.length - rejectCount).map((s) => s.id));
  return photos.map((p) => ({
    ...p,
    status: selectedIds.has(p.id) ? "selected" : rejectedIds.has(p.id) ? "rejected" : "maybe",
  }));
}