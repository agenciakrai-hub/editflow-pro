// Scene Analysis Engine: responsible for reading EXIF and grouping a RAW session's
// images into Scenes (by lighting, lens, camera, hour, color, flash, etc.), then
// selecting representative images within each scene. None of the real grouping or
// clustering algorithms are implemented yet — these are stubs so the rest of the
// architecture (Scene / SceneRecipe / Batch Apply per scene) can be built now.

// Stub: groups images using only camera+lens (from EXIF fields already on Image).
// Real grouping by lighting, hour, color and flash is not implemented yet.
export function detectScenes(images) {
  if (!images.length) return [];
  const keyOf = (image) => `${image.camera || "unknown-camera"}|${image.lens || "unknown-lens"}`;
  const groups = new Map();
  images.forEach((image) => {
    const key = keyOf(image);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
  });
  return Array.from(groups.values()).map((groupImages, index) => ({
    name: `Escena ${index + 1}`,
    scene_type: null,
    lighting: null,
    white_balance: null,
    camera: groupImages[0].camera || null,
    lens: groupImages[0].lens || null,
    images: groupImages
  }));
}

// Stub: evenly-spaced sample within a single scene's images, standing in for future
// visual clustering (exposure, scene, light, color, indoor/outdoor, flash).
export function selectSceneRepresentatives(images) {
  const count = Math.min(images.length, Math.max(3, Math.min(10, Math.round(images.length * 0.15))));
  const step = Math.max(1, Math.floor(images.length / count));
  const selected = [];
  for (let i = 0; i < images.length && selected.length < count; i += step) {
    selected.push({ id: images[i].id, cluster_id: `cluster-${selected.length % count}` });
  }
  return selected;
}