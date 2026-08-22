// Smart selection engine (wedding-raw-ai): scores each photo in a burst using
// photometric analysis (sharpness + exposure quality + contrast) and marks the
// best take as selected (5 stars, green label), rejecting the sisters.

import { analyzeFromUrl } from "./photometricAnalysis.js";

const IDEAL_LUMINANCE = 0.5;

function scorePhoto(metrics) {
  const exposureScore = 1 - Math.min(1, Math.abs(metrics.meanLuminance - IDEAL_LUMINANCE) * 2);
  const sharpnessScore = Math.min(1, metrics.sharpness / 400);
  const contrastScore = Math.min(1, metrics.contrast);
  // penalize blown highlights / crushed shadows
  const tonalPenalty = metrics.highlights * 0.6 + metrics.shadows * 0.4;
  return {
    exposureScore,
    sharpnessScore,
    contrastScore,
    total: exposureScore * 0.35 + sharpnessScore * 0.45 + contrastScore * 0.2 - tonalPenalty * 0.3,
  };
}

export async function analyzeBatch(photos) {
  const results = [];
  for (const p of photos) {
    try {
      const metrics = await analyzeFromUrl(p.file_url || p.thumbnail_url);
      results.push({ photo: p, metrics, score: scorePhoto(metrics) });
    } catch {
      results.push({ photo: p, metrics: null, score: { total: 0 } });
    }
  }
  return results;
}

export function selectBestInBurst(analyzed) {
  if (!analyzed.length) return null;
  return analyzed.reduce((best, cur) => (cur.score.total > best.score.total ? cur : best), analyzed[0]);
}

export function buildSelectionPlan(bursts, analyzedByPhoto) {
  const plan = [];
  for (const burst of bursts) {
    const analyzed = burst.photos
      .map((p) => analyzedByPhoto.get(p.id))
      .filter(Boolean);
    const best = selectBestInBurst(analyzed);
    for (const { photo } of analyzed) {
      const isBest = best && photo.id === best.photo.id;
      plan.push({
        id: photo.id,
        culling_status: isBest ? "selected" : "rejected",
        star_rating: isBest ? 5 : 0,
        color_label: isBest ? "green" : "none",
      });
    }
  }
  return plan;
}