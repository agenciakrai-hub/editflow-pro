// Emotive Film IA — Image-to-Video backend function (multi-proveedor).
//
// Proveedores:
//   nvidia     — NVIDIA Cosmos 3 Nano (FREE, síncrono, b64_video → upload)
//   openrouter — OpenRouter Video API (PREMIUM, async con polling)
//   fal        — fal.ai Kling 3.0 Pro (PREMIUM, async con queue API)
//
// Acciones (auth requerida):
//   submit — Envía la imagen + prompt al proveedor. Devuelve request_id (async)
//           o { status: "COMPLETED", video_url } (síncrono, NVIDIA).
//   status — Consulta el estado del job (async). Si COMPLETED, descarga el vídeo
//           y lo sube a almacenamiento público.
//
// El proxy de la imagen se sube desde el frontend (UploadPublicFile) y se pasa
// como image_url. El original RAW nunca se envía: solo un proxy de alta calidad.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { secrets } from "base44:runtime";

const NVIDIA_ENDPOINT = "https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano";
const OPENROUTER_VIDEOS_URL = "https://openrouter.ai/api/v1/videos";
const FAL_MODEL = "fal-ai/kling-video/v3/pro/image-to-video";
const FAL_QUEUE_BASE = `https://queue.fal.run/${FAL_MODEL}`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body.action;
    const provider = body.provider || "fal";

    if (action === "submit") {
      if (provider === "nvidia") return await doNvidiaSubmit(base44, body);
      if (provider === "openrouter") return await doOpenRouterSubmit(body);
      return await doFalSubmit(body);
    }
    if (action === "status") {
      if (provider === "openrouter") return await doOpenRouterStatus(base44, body);
      return await doFalStatus(body);
    }

    return Response.json({ error: "Acción no soportada: " + action }, { status: 400 });
  } catch (error) {
    console.error("emotive-film-i2v error", error?.message || error);
    return Response.json({ error: error?.message || "Error interno" }, { status: 500 });
  }
}

// ===========================================================================
// NVIDIA Cosmos 3 Nano (FREE, síncrono)
// Endpoint: POST https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano
// I2V: model_mode="image2video", input_reference=URL, respuesta b64_video.
// ===========================================================================
async function doNvidiaSubmit(base44, body) {
  const apiKey = secrets.get("NVIDIA_API_KEY");
  if (!apiKey) {
    return Response.json(
      { error: "NVIDIA_API_KEY no configurada. Añade tu API key de NVIDIA en Secrets." },
      { status: 500 }
    );
  }

  const { image_url, prompt, aspect_ratio } = body;
  if (!image_url) return Response.json({ error: "Falta image_url" }, { status: 400 });
  if (!prompt) return Response.json({ error: "Falta prompt" }, { status: 400 });

  // Mapea aspect ratio al formato de NVIDIA: "<tier>_<ar>" (480p para free tier).
  const ar = aspect_ratio || "16:9";
  const arSuffix = ar === "9:16" ? "9_16" : ar === "1:1" ? "1_1" : "16_9";
  const resolution = `480_${arSuffix}`;

  // Calcula frames desde la duración (24fps). 480 tier: 25-297 frames.
  const fps = 24;
  const duration = Number(body.duration) || 5;
  const num_frames = Math.min(297, Math.max(25, Math.round(duration * fps)));

  const payload = {
    model_mode: "image2video",
    prompt,
    input_reference: image_url,
    resolution,
    num_frames,
    num_inference_steps: 35,
    fps,
    seed: Math.floor(Math.random() * 1000000),
  };

  console.log("NVIDIA I2V submit:", { resolution, num_frames, prompt: prompt.slice(0, 80) });

  const apiRes = await fetch(NVIDIA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error("NVIDIA I2V error", apiRes.status, errText.slice(0, 500));
    return Response.json(
      { error: `NVIDIA error ${apiRes.status}: ${errText.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const data = await apiRes.json();
  const b64Video = data?.b64_video;
  if (!b64Video) {
    return Response.json({ error: "NVIDIA no devolvió vídeo (b64_video vacío)" }, { status: 502 });
  }

  // Decodifica base64 → Blob → sube a almacenamiento público.
  const binaryString = atob(b64Video);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const blob = new Blob([bytes], { type: "video/mp4" });

  const uploadRes = await base44.integrations.Core.UploadPublicFile({ file: blob });
  const videoUrl = uploadRes?.file_url;
  if (!videoUrl) return Response.json({ error: "No se pudo subir el vídeo NVIDIA" }, { status: 500 });

  console.log("NVIDIA I2V completed:", { videoUrl: videoUrl.slice(0, 60) });
  return Response.json({ status: "COMPLETED", video_url: videoUrl });
}

// ===========================================================================
// OpenRouter Video (PREMIUM, async con polling)
// Endpoint: POST https://openrouter.ai/api/v1/videos
// I2V: frame_images con frame_type="first_frame", polling en /videos/<id>.
// ===========================================================================
async function doOpenRouterSubmit(body) {
  const apiKey = secrets.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return Response.json(
      { error: "OPENROUTER_API_KEY no configurada. Añade tu API key de OpenRouter en Secrets." },
      { status: 500 }
    );
  }

  const { image_url, prompt, model, resolution } = body;
  if (!image_url) return Response.json({ error: "Falta image_url" }, { status: 400 });
  if (!prompt) return Response.json({ error: "Falta prompt" }, { status: 400 });

  const payload = {
    model: model || "bytedance/seedance-2.0-mini",
    prompt,
    frame_images: [
      {
        type: "image_url",
        image_url: { url: image_url },
        frame_type: "first_frame",
      },
    ],
    resolution: resolution || "720p",
  };

  console.log("OpenRouter I2V submit:", { model: payload.model, resolution: payload.resolution });

  const apiRes = await fetch(OPENROUTER_VIDEOS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error("OpenRouter submit error", apiRes.status, errText.slice(0, 500));
    return Response.json(
      { error: `OpenRouter error ${apiRes.status}: ${errText.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const data = await apiRes.json();
  const requestId = data?.id;
  if (!requestId) return Response.json({ error: "OpenRouter no devolvió job_id" }, { status: 502 });

  return Response.json({ request_id: requestId, status: "pending" });
}

// OpenRouter status: consulta el estado del job. Si completed, descarga el vídeo
// de unsigned_urls[0] (requiere auth) y lo sube a almacenamiento público.
async function doOpenRouterStatus(base44, body) {
  const apiKey = secrets.get("OPENROUTER_API_KEY");
  if (!apiKey) return Response.json({ error: "OPENROUTER_API_KEY no configurada" }, { status: 500 });

  const { request_id } = body;
  if (!request_id) return Response.json({ error: "Falta request_id" }, { status: 400 });

  const statusRes = await fetch(`${OPENROUTER_VIDEOS_URL}/${request_id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!statusRes.ok) {
    const errText = await statusRes.text();
    console.error("OpenRouter status error", statusRes.status, errText.slice(0, 300));
    return Response.json(
      { error: `OpenRouter status error ${statusRes.status}: ${errText.slice(0, 300)}` },
      { status: 502 }
    );
  }

  const statusData = await statusRes.json();

  if (statusData.status === "completed") {
    const unsignedUrls = statusData?.unsigned_urls || [];
    if (!unsignedUrls.length) {
      return Response.json({ status: "COMPLETED", video_url: null, error: "No hay URL de vídeo" });
    }

    // Descarga el vídeo (requiere auth) y lo sube a almacenamiento público.
    const videoRes = await fetch(unsignedUrls[0], {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!videoRes.ok) {
      return Response.json({ status: "COMPLETED", video_url: null, error: "No se pudo descargar el vídeo" });
    }

    const videoBlob = await videoRes.blob();
    const uploadRes = await base44.integrations.Core.UploadPublicFile({ file: videoBlob });
    const videoUrl = uploadRes?.file_url;
    if (!videoUrl) return Response.json({ error: "No se pudo subir el vídeo OpenRouter" }, { status: 500 });

    console.log("OpenRouter I2V completed:", { videoUrl: videoUrl.slice(0, 60) });
    return Response.json({ status: "COMPLETED", video_url: videoUrl });
  }

  if (statusData.status === "failed") {
    return Response.json({ status: "FAILED", error: statusData?.error || "Generación fallida" });
  }

  // pending / processing
  return Response.json({ status: "IN_QUEUE" });
}

// ===========================================================================
// fal.ai Kling 3.0 Pro (PREMIUM, async con queue API)
// Endpoint: POST https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video
// ===========================================================================
async function doFalSubmit(body) {
  const apiKey = secrets.get("FAL_API_KEY");
  if (!apiKey) {
    return Response.json(
      { error: "FAL_API_KEY no configurada. Añade tu API key de fal.ai en Secrets." },
      { status: 500 }
    );
  }

  const { image_url, prompt, duration, negative_prompt, cfg_scale } = body;
  if (!image_url) return Response.json({ error: "Falta image_url" }, { status: 400 });
  if (!prompt) return Response.json({ error: "Falta prompt" }, { status: 400 });

  const dur = String(Math.min(15, Math.max(3, Number(duration) || 5)));

  const payload = {
    start_image_url: image_url,
    prompt,
    duration: dur,
    negative_prompt:
      negative_prompt ||
      "blur, distort, low quality, deformed faces, deformed hands, extra people, changed clothing, duplicated people, morphed bodies, artificial body movement, identity change",
    cfg_scale: Number(cfg_scale) || 0.5,
  };

  console.log("fal.ai I2V submit:", { prompt: prompt.slice(0, 80), duration: dur });

  const res = await fetch(FAL_QUEUE_BASE, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("fal.ai submit error", res.status, errText.slice(0, 500));
    return Response.json(
      { error: `fal.ai error ${res.status}: ${errText.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  return Response.json({
    request_id: data.request_id,
    status: data.status || "IN_QUEUE",
  });
}

// fal.ai status: consulta el estado del job. Si COMPLETED, obtiene video_url.
async function doFalStatus(body) {
  const apiKey = secrets.get("FAL_API_KEY");
  if (!apiKey) return Response.json({ error: "FAL_API_KEY no configurada" }, { status: 500 });

  const { request_id } = body;
  if (!request_id) return Response.json({ error: "Falta request_id" }, { status: 400 });

  const statusUrl = `${FAL_QUEUE_BASE}/requests/${request_id}/status`;
  const statusRes = await fetch(statusUrl, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  if (!statusRes.ok) {
    const errText = await statusRes.text();
    console.error("fal.ai status error", statusRes.status, errText.slice(0, 300));
    return Response.json(
      { error: `fal.ai status error ${statusRes.status}: ${errText.slice(0, 300)}` },
      { status: 502 }
    );
  }

  const statusData = await statusRes.json();

  if (statusData.status === "COMPLETED") {
    const resultUrl = `${FAL_QUEUE_BASE}/requests/${request_id}`;
    const resultRes = await fetch(resultUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (!resultRes.ok) {
      return Response.json({ status: "COMPLETED", video_url: null, error: "No se pudo obtener el resultado" });
    }
    const resultData = await resultRes.json();
    const video_url = resultData?.data?.video?.url || null;
    const video_size = resultData?.data?.video?.file_size || 0;
    console.log("fal.ai I2V completed:", { request_id, video_url: video_url?.slice(0, 60) });
    return Response.json({ status: "COMPLETED", video_url, video_size });
  }

  if (statusData.status === "FAILED") {
    const errMsg = statusData.error || statusData?.logs?.find((l) => l.level === "ERROR")?.message || "Generación fallida";
    console.error("fal.ai I2V failed:", request_id, errMsg);
    return Response.json({ status: "FAILED", error: errMsg });
  }

  return Response.json({ status: statusData.status || "IN_QUEUE" });
}