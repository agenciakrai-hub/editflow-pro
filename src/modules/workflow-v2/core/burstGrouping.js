// EditFlow V2 — agrupador independiente. No importa ni modifica motores antiguos.
// Exige dos evidencias para unir fotografías: proximidad temporal y similitud visual.
import { phashDistance } from "@/lib/rawaistudio/perceptualHash";

const DEFAULTS = Object.freeze({ maxGapMs: 2400, maxHashDistance: 10, maxGroup: 40 });

function captureTimeOf(photo) {
  return Number.isFinite(photo.captureTime) ? photo.captureTime : Number(photo.file?.lastModified || 0);
}

export function buildReliableBursts(photos, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const ordered = [...photos].sort((a, b) => captureTimeOf(a) - captureTimeOf(b) || String(a.file?.name).localeCompare(String(b.file?.name)));
  const groups = [];

  for (const photo of ordered) {
    const previous = groups.at(-1);
    const last = previous?.photos.at(-1);
    const dt = last ? Math.abs(captureTimeOf(photo) - captureTimeOf(last)) : Infinity;
    const hashDistance = last ? phashDistance(photo.phash, last.phash) : -1;
    // Sin hash no se presupone que sean la misma ráfaga: evita mezclar escenas.
    const sameBurst = !!previous && previous.photos.length < cfg.maxGroup && dt <= cfg.maxGapMs && hashDistance >= 0 && hashDistance <= cfg.maxHashDistance;
    if (sameBurst) {
      previous.photos.push(photo);
      previous.max_gap_ms = Math.max(previous.max_gap_ms, dt);
      previous.max_hash_distance = Math.max(previous.max_hash_distance, hashDistance);
    } else {
      groups.push({ id: `v2-burst-${groups.length + 1}`, photos: [photo], max_gap_ms: 0, max_hash_distance: 0 });
    }
  }

  return groups.map((group) => ({
    ...group,
    confidence: group.photos.length === 1 ? "single" : group.max_hash_distance <= 6 && group.max_gap_ms <= 1200 ? "high" : "review",
  }));
}

