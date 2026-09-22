// Pipeline de generación de HERO VIDEOS — arquitectura multi-proveedor.
//
// Orquesta para cada hero shot:
//   prompt → upload proxy → submit I2V (cadena de proveedores) → poll → validate → fallback 2D
//
// Cadena de proveedores (configurable):
//   NVIDIA FREE → OpenRouter (si habilitado) → fal.ai (si habilitado) → fallback 2D
//
// El I2VCostGuard impide llamadas de pago no autorizadas: solo prueba proveedores
// habilitados. NVIDIA (FREE) es el proveedor por defecto. fal.ai está DESACTIVADO
// por defecto — nunca consume créditos sin consentimiento explícito.
//
// Persiste el estado en la entidad EmotiveFilm (hero_videos) tras cada shot,
// de forma que el usuario puede cerrar la app y continuar después.

import { getI2VProvider } from "./i2vProvider";
import { getFallbackChain, I2V_PROVIDERS } from "./i2vCostGuard";
import { buildHeroPrompt, buildConservativePrompt } from "./heroPromptBuilder";
import { validateHeroVideo } from "./videoValidator";
import { getCachedPreview } from "@/modules/proyectos/lib/previewCache";
import { upsertFilm } from "./filmStore";

const POLL_INTERVAL = 5000; // 5s entre polls
const POLL_TIMEOUT = 240000; // 4min máximo por shot

// Genera los HERO VIDEOS para los hero shots del film plan.
// settings: { i2v_duration, i2v_max_shots, i2v_provider, i2v_nvidia_enabled, ... }
// exportConfig: { aspect_ratio, resolution } — para adaptar el I2V al formato final.
// Devuelve el mapa hero_videos actualizado.
export async function generateHeroVideos({
  projectId,
  filmPlan,
  heroVideos = {},
  settings = {},
  exportConfig = {},
  onProgress,
  signal,
}) {
  const chain = getFallbackChain(settings);
  if (!chain.length) {
    // Ningún proveedor habilitado — todos los shots van a fallback 2D.
    onProgress?.(null, "no_providers", { reason: "No hay proveedores I2V habilitados" });
  }

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

    onProgress?.(hash, "starting", { chain });
    updated[hash] = await generateOneHeroShot(clip, chain, settings, exportConfig, updated[hash], onProgress, signal);

    // Persiste tras cada shot (resumable).
    await upsertFilm(projectId, { hero_videos: updated, status: "generating_heroes" });
  }

  return updated;
}

// Genera un hero shot individual recorriendo la cadena de proveedores.
// Si todos los proveedores fallan, marca como fallback (motor 2D).
async function generateOneHeroShot(clip, chain, settings, exportConfig, existing, onProgress, signal) {
  const hash = clip.hash;
  const state = existing || { status: "pending", attempts: 0 };

  let prompt = state.prompt || buildHeroPrompt(clip);
  let attempts = state.attempts || 0;
  const i2vDuration = settings.i2v_duration || 5;
  const aspectRatio = exportConfig?.aspect_ratio || "16:9";

  // Si no hay proveedores habilitados, fallback inmediato.
  if (!chain.length) {
    onProgress?.(hash, "fallback", { error: "No hay proveedores I2V habilitados" });
    return {
      status: "fallback",
      fallback_used: true,
      prompt,
      attempts: 0,
      error: "Sin proveedores I2V — motor cinematográfico 2D",
      generated_at: Date.now(),
    };
  }

  // Obtiene el preview de alta calidad desde IndexedDB (local-first).
  let blob;
  try {
    const preview = await getCachedPreview(hash);
    const bestUrl = preview?.hiResDataUrl || preview?.dataUrl;
    if (!bestUrl) throw new Error("Preview no disponible en caché local");
    blob = dataUrlToBlob(bestUrl);
  } catch (e) {
    onProgress?.(hash, "fallback", { error: e.message });
    return { ...state, status: "fallback", fallback_used: true, error: e.message, generated_at: Date.now() };
  }

  // Recorre la cadena de proveedores: NVIDIA → OpenRouter → fal.ai → fallback 2D.
  for (const providerId of chain) {
    if (signal?.aborted) return { ...state, status: "failed", error: "Cancelado" };

    const meta = I2V_PROVIDERS[providerId];
    onProgress?.(hash, "submitting", { provider: providerId, tier: meta?.tier });

    try {
      const provider = getI2VProvider(providerId, {
        duration: i2vDuration,
        aspectRatio,
        model: settings.i2v_openrouter_model,
        resolution: exportConfig?.resolution === "4k" ? "1080p" : "720p",
      });

      // 1. Submit al proveedor.
      onProgress?.(hash, "submitting", { provider: providerId });
      const { request_id, image_url, video_url, synchronous } = await provider.submit(blob, prompt);

      // 2. Si es síncrono (NVIDIA), video_url ya está disponible. Si no, poll.
      let finalVideoUrl = video_url;
      if (!synchronous && request_id) {
        onProgress?.(hash, "processing", { provider: providerId, request_id });
        finalVideoUrl = await pollJob(provider, request_id, signal);
      }

      // 3. Validar vídeo (duración, resolución, frames negros).
      onProgress?.(hash, "validating", { provider: providerId });
      const validation = await validateHeroVideo(finalVideoUrl, i2vDuration);

      if (validation.valid) {
        onProgress?.(hash, "completed", { provider: providerId, video_url: finalVideoUrl });
        return {
          status: "completed",
          video_url: finalVideoUrl,
          provider: providerId,
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

      // Validación falló: reintento con prompt conservador en el siguiente proveedor.
      attempts++;
      prompt = buildConservativePrompt(clip);
      onProgress?.(hash, "retrying", { provider: providerId, errors: validation.errors });
    } catch (e) {
      attempts++;
      console.warn(`Hero shot ${hash} provider ${providerId} failed:`, e.message);
      onProgress?.(hash, "provider_failed", { provider: providerId, error: e.message });
      // Continúa al siguiente proveedor de la cadena.
    }
  }

  // Todos los proveedores fallaron: fallback al motor 2D.
  onProgress?.(hash, "fallback", { error: "Todos los proveedores I2V fallaron" });
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