// ImageToVideoProvider — abstracción para proveedores de Image-to-Video.
// Implementación actual: Kling 3.0 Pro vía fal.ai.
//
// Para cambiar de proveedor en el futuro, crea una nueva clase que implemente
// la misma interfaz (submit, poll, downloadVideo) y sustituye getI2VProvider().
// El resto de Emotive Film NO necesita cambios.
import { base44 } from "@/api/base44Client";

export class KlingFalProvider {
  constructor(config = {}) {
    this.config = {
      model: "fal-ai/kling-video/v3/pro/image-to-video",
      duration: config.duration || 5,
      cfg_scale: config.cfg_scale ?? 0.5,
      ...config,
    };
  }

  // Sube un proxy de la imagen a almacenamiento público y lo envía al proveedor.
  // imageBlob: Blob de la imagen (proxy de alta calidad, NO el original RAW).
  // prompt: prompt cinematográfico para el movimiento.
  // Devuelve { request_id, image_url } para polling.
  async submit(imageBlob, prompt) {
    // 1. Subir el proxy a almacenamiento público (fal.ai necesita una URL pública).
    const uploadRes = await base44.integrations.Core.UploadPublicFile({ file: imageBlob });
    const imageUrl = uploadRes?.file_url;
    if (!imageUrl) throw new Error("No se pudo subir el proxy de la imagen");

    // 2. Enviar al proveedor I2V vía backend function (mantiene la API key en el servidor).
    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "submit",
      image_url: imageUrl,
      prompt,
      duration: this.config.duration,
      cfg_scale: this.config.cfg_scale,
    });

    const requestId = res?.data?.request_id;
    if (!requestId) throw new Error(res?.data?.error || "No se pudo enviar a fal.ai");
    return { request_id: requestId, image_url: imageUrl };
  }

  // Consulta el estado de un job. Devuelve { status, video_url?, error? }.
  async poll(request_id) {
    const res = await base44.functions.invoke("emotive-film-i2v", {
      action: "status",
      request_id,
    });
    return res?.data || { status: "UNKNOWN" };
  }

  // Descarga el vídeo generado como Blob (para validación local).
  async downloadVideo(videoUrl) {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Error descargando vídeo: ${res.status}`);
    return await res.blob();
  }
}

// Provider singleton. Configurable desde la UI en el futuro.
let _provider = null;
export function getI2VProvider(config) {
  if (!_provider || config) _provider = new KlingFalProvider(config);
  return _provider;
}

export function resetI2VProvider() {
  _provider = null;
}