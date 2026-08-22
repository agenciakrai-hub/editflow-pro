// Burst grouping (wedding-raw-ai) — groups photos taken in the same burst/scene.
// Without EXIF capture time we derive a burst key from the filename: strip a
// trailing numeric sequence so IMG_1440 / IMG_1441 collapse to the same group.

export function burstKey(filename) {
  const base = (filename || "").replace(/\.[^.]+$/, "");
  const stripped = base.replace(/[_-]?\d{1,4}$/, "");
  return stripped || base;
}

export function groupByBursts(photos) {
  const map = new Map();
  for (const p of photos) {
    const key = burstKey(p.filename || p.id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  // Only keep real bursts (2+ photos); singletons get their own group too.
  return Array.from(map.entries()).map(([key, items]) => ({ key, photos: items }));
}