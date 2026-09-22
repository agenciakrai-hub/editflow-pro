// ImageToVideoProvider — arquitectura multi-proveedor.
//
// Proveedores:
//   NVIDIAProvider     — NVIDIA Cosmos 3 Nano (FREE, experimental, síncrono)
//   OpenRouterProvider — OpenRouter Video API (PREMIUM, async con polling)
//   FalProvider        — fal.ai Kling 3.0 Pro (PREMIUM, async con polling)
//
// Todos implementan la misma interfaz: submit(imageBlob, prompt) → { request_id?, video_url?, synchronous }
// y poll(request_id) → { status, video_url?, error? }.
// El resto de Emotive Film NO necesita cambios al cambiar de proveedor.

import { base44 } from "@/api/base44Client";

// --- NVIDIA Cosmos 3 Nano (FREE, síncrono) ---
// Endpoint: POST https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano
// I2V: model_mode="image2video", input_reference=URL pública, respuesta b64_video.
// El backend descodifica el base64, lo sube a almacenamiento público y devuelve video_url.
export class NVIDIAProvider {
  constructor(config = {}) {
    this.config = {
      duration: config.duration || 5,
      aspectRatio: config.aspectRatio || "16:9",
      ...config,
    };
  }

  async submit(imageBlob, prompt) {
    const uploadRes = await base44.integrations.Core.UploadPublicFile({ file: imageBlob });
    const imageUrl = uploadRes?.file_url;
    if (!imageUrl) throw new Error("No se pudo subir el proxy de la imagen");

    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "submit",
      provider: "nvidia",
      image_url: imageUrl,
      prompt,
      duration: this.config.duration,
      aspect_ratio: this.config.aspectRatio,
    });

    // NVIDIA es síncrono: devuelve COMPLETED con video_url directamente.
    if (res?.data?.status === "COMPLETED" && res?.data?.video_url) {
      return { request_id: null, image_url: imageUrl, video_url: res.data.video_url, synchronous: true };
    }
    throw new Error(res?.data?.error || "NVIDIA no respondió correctamente");
  }

  async poll(_request_id) {
    // NVIDIA es síncrono — poll nunca debería llamarse.
    return { status: "UNKNOWN" };
  }

  async downloadVideo(videoUrl) {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Error descargando vídeo: ${res.status}`);
    return await res.blob();
  }
}

// --- OpenRouter Video (PREMIUM, async) ---
// Endpoint: POST https://openrouter.ai/api/v1/videos
// I2V: frame_images con frame_type="first_frame", polling async.
// El backend descarga el vídeo de unsigned_urls[0] (requiere auth) y lo sube a público.
export class OpenRouterProvider {
  constructor(config = {}) {
    this.config = {
      model: config.model || "bytedance/seedance-2.0-mini",
      resolution: config.resolution || "720p",
      ...config,
    };
  }

  async submit(imageBlob, prompt) {
    const uploadRes = await base44.integrations.Core.UploadPublicFile({ file: imageBlob });
    const imageUrl = uploadRes?.file_url;
    if (!imageUrl) throw new Error("No se pudo subir el proxy de la imagen");

    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "submit",
      provider: "openrouter",
      image_url: imageUrl,
      prompt,
      model: this.config.model,
      resolution: this.config.resolution,
    });

    const requestId = res?.data?.request_id;
    if (!requestId) throw new Error(res?.data?.error || "OpenRouter no respondió");
    return { request_id: requestId, image_url: imageUrl, synchronous: false };
  }

  async poll(request_id) {
    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "status",
      provider: "openrouter",
      request_id,
    });
    return res?.data || { status: "UNKNOWN" };
  }

  async downloadVideo(videoUrl) {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Error descargando vídeo: ${res.status}`);
    return await res.blob();
  }
}

// --- fal.ai Kling 3.0 Pro (PREMIUM, async) ---
// Endpoint: POST https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video
// I2V: start_image_url + prompt, polling async con queue API.
export class FalProvider {
  constructor(config = {}) {
    this.config = {
      model: "fal-ai/kling-video/v3/pro/image-to-video",
      duration: config.duration || 5,
      cfg_scale: config.cfg_scale ?? 0.5,
      ...config,
    };
  }

  async submit(imageBlob, prompt) {
    const uploadRes = await base44.integrations.Core.UploadPublicFile({ file: imageBlob });
    const imageUrl = uploadRes?.file_url;
    if (!imageUrl) throw new Error("No se pudo subir el proxy de la imagen");

    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "submit",
      provider: "fal",
      image_url: imageUrl,
      prompt,
      duration: this.config.duration,
      cfg_scale: this.config.cfg_scale,
    });

    const requestId = res?.data?.request_id;
    if (!requestId) throw new Error(res?.data?.error || "fal.ai no respondió");
    return { request_id: requestId, image_url: imageUrl, synchronous: false };
  }

  async poll(request_id) {
    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "status",
      provider: "fal",
      request_id,
    });
    return res?.data || { status: "UNKNOWN" };
  }

  async downloadVideo(videoUrl) {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Error descargando vídeo: ${res.status}`);
    return await res.blob();
  }
}

// Factory: crea el proveedor por id.
const PROVIDERS = {
  nvidia: NVIDIAProvider,
  openrouter: OpenRouterProvider,
  fal: FalProvider,
};

export function getI2VProvider(providerId, config = {}) {
  const ProviderClass = PROVIDERS[providerId];
  if (!ProviderClass) throw new Error(`Proveedor I2V desconocido: ${providerId}`);
  return new ProviderClass(config);
}