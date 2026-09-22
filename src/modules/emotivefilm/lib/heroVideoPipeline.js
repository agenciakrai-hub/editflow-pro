// Pipeline de generación de HERO VIDEOS.
//
// Orquesta para cada hero shot:
//   prompt → upload proxy → submit I2V → poll → download → validate → fallback
//
// Persiste el estado en la entidad EmotiveFilm (hero_videos) tras cada shot,
// de forma que el usuario puede cerrar la app y continuar después.
//
// Fallback: si un hero shot falla tras MAX_RETRIES intentos, se marca como
// "fallback" y el renderer usa el motor cinematográfico 2D para ese clip.
// NUNCA queda un hueco negro ni un clip roto en la película.

import { getI2VProvider } from "./i2vProvider";
import { buildHeroPrompt, buildConservativePrompt } from "./heroPromptBuilder";
import { validateHeroVideo } from "./videoValidator";
import { getCachedPreview } from "@/modules/proyectos/lib/previewCache";
import { upsertFilm } from "./filmStore";

const MAX_RETRIES = 2;
const POLL_INTERVAL = 5000; // 5s entre polls
const POLL_TIMEOUT = 240000; // 4min máximo por shot

// Genera los HERO VIDEOS para los hero shots del film plan.
// heroVideos: estado previo (para reanudar).
// onProgress(hash, status, info): notifica el avance de cada shot.
// signal: { aborted } para cancelar.
// settings: { i2v_duration, i2v_max_shots } configuración del pipeline.
// Devuelve el mapa hero_videos actualizado.
export async function generateHeroVideos({
  projectId,
  filmPlan,
  heroVideos = {},
  settings = {},
  onProgress,
  signal,
}) {
  const provider = getI2VProvider({
    duration: settings.i2v_duration || 5,
  cfg_scale: 0.5,
  });

  // Obtiene los hero shots del plan (marcados por el AI Film Director).
  const heroClips = (filmPlan?.timeline || []).filter((t) => t.is_hero);
  const maxShots = settings.i2v_max_shots || 20;
  const clips = heroClips.slice(0, maxShots);

  if (!clips.length) return heroVideos;

  const updated = { ...heroVideos };

  for (const clip of clips) {
    if (signal?.aborted) break;
    const hash = clip.hash;

    // Skip si ya está completado con vídeo válido o en fallback permanente.
    if (updated[hash]?.status === "completed" && updated[hash]?.video_url) {
      onProgress?.(hash, "skipped", { reason: "already_completed" });
      continue;
    }
    if (updated[hash]?.status === "fallback" && !updated[hash]?.retry) {
      onProgress?.(hash, "skipped", { reason: "fallback" });
      continue;
    }

    onProgress?.(hash, "starting", {});
    updated[hash] = await generateOneHeroShot(clip, provider, updated[hash], settings, onProgress, signal);

    // Persiste tras cada shot (resumable: el usuario puede cerrar y volver).
    await upsertFilm(projectId, { hero_videos: updated, status: "generating_heroes" });
  }

  return updated;
}

// Genera un hero shot individual con reintentos y fallback.
async function generateOneHeroShot(clip, provider, existing, settings, onProgress, signal) {
  const hash = clip.hash;
  const state = existing || { status: "pending", attempts: 0 };

  let prompt = state.prompt || buildHeroPrompt(clip);
  let attempts = state.attempts || 0;
  const i2vDuration = settings.i2v_duration || 5;

  while (attempts <= MAX_RETRIES) {
    if (signal?.aborted) return { ...state, status: "failed", error: "Cancelado" };

    try {
      // 1. Obtener preview de alta calidad desde IndexedDB (local-first).
      onProgress?.(hash, "uploading", { attempt: attempts + 1 });
      const preview = await getCachedPreview(hash);
      const bestUrl = preview?.hiResDataUrl || preview?.dataUrl;
      if (!bestUrl) throw new Error("Preview no disponible en caché local");

      // 2. Convertir data URL a Blob (proxy de alta calidad, NO el original).
      const blob = dataUrlToBlob(bestUrl);

      // 3. Subir proxy + submit a I2V (fal.ai Kling 3.0 Pro).
      onProgress?.(hash, "submitting", { attempt: attempts + 1 });
      const { request_id, image_url } = await provider.submit(blob, prompt);

      // 4. Poll hasta completar o fallar.
      onProgress?.(hash, "processing", { attempt: attempts + 1, request_id });
      const videoUrl = await pollJob(provider, request_id, signal);

      // 5. Validar vídeo (duración, resolución, frames negros).
      onProgress?.(hash, "validating", { attempt: attempts + 1 });
      const validation = await validateHeroVideo(videoUrl, i2vDuration);

      if (validation.valid) {
        onProgress?.(hash, "completed", { video_url: videoUrl });
        return {
          status: "completed",
          video_url: videoUrl,
          prompt,
          request_id,
          image_url,
          attempts: attempts + 1,
          validated: true,
          validation: {
            duration: validation.duration,
            width: validation.width,
            height: validation.height,
          },
          generated_at: Date.now(),
        };
      }

      // Validación falló: reintento con prompt conservador.
      attempts++;
      prompt = buildConservativePrompt(clip);
      onProgress?.(hash, "retrying", { attempt: attempts, errors: validation.errors });
    } catch (e) {
      attempts++;
      console.warn(`Hero shot ${hash} attempt ${attempts} failed:`, e.message);
      onProgress?.(hash, "retrying", { attempt: attempts, error: e.message });

      if (attempts > MAX_RETRIES) break;
    }
  }

  // Todos los intentos fallaron: fallback al motor 2D.
  onProgress?.(hash, "fallback", { error: state.error || "Todos los intentos fallaron" });
  return {
    status: "fallback",
    fallback_used: true,
    prompt,
    attempts,
    error: "Fallback al motor cinematográfico 2D tras fallos de I2V",
    generated_at: Date.now(),
  };
}

// Poll del job hasta COMPLETED, FAILED o timeout.
async function pollJob(provider, requestId, signal) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT) {
    if (signal?.aborted) throw new Error("Cancelado");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const result = await provider.poll(requestId);
    if (result.status === "COMPLETED" && result.video_url) return result.video_url;
    if (result.status === "FAILED") throw new Error(result.error || "Generación fallida");
    // IN_QUEUE o IN_PROGRESS: seguir esperando.
  }
  throw new Error("Timeout esperando generación de vídeo (4min)");
}

// Convierte un data URL (base64) a Blob para subirlo como proxy.
function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}