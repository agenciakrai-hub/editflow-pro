// Fase 2 — ORQUESTADOR del análisis visual IA para la maquetación automática.
// Reutiliza el backend album-engine (cadena de proveedores + consentimiento de
// Album AI) y el sanitizer/previewStore existentes: NO crea un segundo sistema de
// IA. Devuelve un Map<photoId, photoVisualProfile> con caché en memoria por
// photoId + content_hash.
//
// FALLBACK OBLIGATORIO: ante cualquier fallo (consentimiento no guardado/revocado,
// timeout, red, respuesta inválida, foto sin preview) devuelve un mapa vacío y la
// maquetación continúa con la Fase 1 determinista pura. NUNCA bloquea al usuario.
import { base44 } from "@/api/base44Client";
import { getTierPreview } from "@/modules/album/lib/previewStore";
import { sanitizeForAi } from "@/modules/album/selection/sanitizer";
import { normalizeProfile } from "@/modules/album/layout/visualProfile";

const BATCH = 12;
const CONCURRENCY = 2;
// Caché en memoria: key `${photoId}:${content_hash}` -> perfil | null. null = ya
// intentado y sin perfil (no reintentar en la misma sesión). Sobrevive entre
// maquetaciones de la misma sesión; se invalida si la foto cambia (content_hash).
const cache = new Map();

// Solo se activa si el fotógrafo YA guardó consentimiento de Album AI y no lo
// revocó. Reutiliza el consentimiento existente: la Fase 2 no añade UI de
// consentimiento propia. Sin consentimiento → Fase 1 (transparente).
async function consentGranted() {
  try {
    const list = await base44.entities.AlbumAIConfig.list();
    const cfg = Array.isArray(list) && list.length ? list[0] : null;
    return !!cfg && !cfg.revoked && !!cfg.consent_saved_at;
  } catch {
    return false;
  }
}

async function sanitizedThumb(projectId, photo) {
  const src = (await getTierPreview(projectId, photo.id, "preview")) || (await getTierPreview(projectId, photo.id, "thumb"));
  if (!src) return null;
  try { return await sanitizeForAi(src); } catch { return null; }
}

async function callVisualProfile(batch) {
  const res = await base44.functions.invoke("album-engine", {
    action: "visual-profile",
    consent: true,
    batch,
  });
  return res?.data ?? res;
}

// Analiza las fotos dadas y devuelve Map<photoId, profile>. NUNCA lanza.
export async function analyzePhotosForLayout(projectId, photos) {
  const out = new Map();
  if (!photos?.length) return out;
  if (!(await consentGranted())) return out;

  const pending = [];
  for (const p of photos) {
    const key = `${p.id}:${p.content_hash || ""}`;
    if (cache.has(key)) {
      const v = cache.get(key);
      if (v) out.set(p.id, v);
      continue;
    }
    pending.push({ photo: p, key });
  }
  if (!pending.length) return out;

  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(processBatch));
  }
  return out;

  async function processBatch(group) {
    const items = [];
    for (const { photo, key } of group) {
      const thumb = await sanitizedThumb(projectId, photo);
      if (thumb?.dataUrl) items.push({ alias: photo.id, thumb: thumb.dataUrl, key, photo });
      else cache.set(key, null); // sin preview local → sin perfil (no reintentar)
    }
    if (!items.length) return;
    let resp = null;
    try {
      resp = await callVisualProfile(items.map((it) => ({ alias: it.alias, thumb: it.thumb, orientation: it.photo.orientation })));
    } catch {
      resp = null; // timeout / red / consent_revoked → fallback silencioso
    }
    const byAlias = new Map((resp?.profiles || []).map((pr) => [pr.alias, pr]));
    for (const it of items) {
      const raw = byAlias.get(it.alias);
      const prof = raw ? normalizeProfile(raw, it.photo) : null;
      cache.set(it.key, prof);
      if (prof) out.set(it.alias, prof);
    }
  }
}

// Perfil visual IA cacheado de una foto en ESTA sesión (lectura SIN red). Lo usa
// el ajuste automático al contenedor (smartFill) como punto de interés cuando el
// navegador no detecta caras: protege al sujeto señalado por la IA visual.
export function getCachedVisualProfile(photo) {
  if (!photo?.id) return null;
  return cache.get(`${photo.id}:${photo.content_hash || ""}`) ?? null;
}

// Invalida el perfil cacheado de una foto (p. ej. tras reemplazar su archivo).
export function invalidatePhoto(photoId, contentHash) {
  cache.delete(`${photoId}:${contentHash || ""}`);
}