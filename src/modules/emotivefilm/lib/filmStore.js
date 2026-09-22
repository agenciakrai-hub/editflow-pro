// Store del EmotiveFilm: CRUD sobre la entidad. Un EmotiveFilm por proyecto.
import { base44 } from "@/api/base44Client";

export async function getFilm(projectId) {
  const rows = await base44.entities.EmotiveFilm.filter({ project_id: projectId });
  return rows[0] || null;
}

export async function createFilm(data) {
  return base44.entities.EmotiveFilm.create(data);
}

export async function updateFilm(id, data) {
  return base44.entities.EmotiveFilm.update(id, data);
}

export async function upsertFilm(projectId, data) {
  const existing = await getFilm(projectId);
  if (existing) return updateFilm(existing.id, { ...data, updated_date: undefined });
  return createFilm({ project_id: projectId, ...data });
}

// Fusión segura del análisis en la caché (analysis_cache). No sobrescribe el
// registro completo: solo añade/actualiza las entradas de caché nuevas.
export async function mergeAnalysisCache(film, entries) {
  if (!entries?.length) return film;
  const cache = { ...(film?.analysis_cache || {}) };
  for (const e of entries) {
    if (e?.fingerprint_hash) cache[e.fingerprint_hash] = e;
  }
  const updated = await updateFilm(film.id, { analysis_cache: cache });
  return { ...film, analysis_cache: cache, ...updated };
}