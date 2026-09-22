// Emotive Film IA — Image-to-Video backend function.
// Proveedor: Kling 3.0 Pro vía fal.ai (queue API).
//
// Acciones (auth requerida):
//   submit — Sube la imagen a fal.ai y devuelve request_id para polling.
//   status — Consulta el estado del job. Si COMPLETED, devuelve video_url.
//
// El proxy de la imagen se sube desde el frontend (UploadPublicFile) y se pasa
// como image_url. El original RAW nunca se envía: solo un proxy de alta calidad.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { secrets } from "base44:runtime";

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

    if (action === "submit") return await doSubmit(body);
    if (action === "status") return await doStatus(body);

    return Response.json({ error: "Acción no soportada: " + action }, { status: 400 });
  } catch (error) {
    console.error("emotive-film-i2v error", error?.message || error);
    return Response.json({ error: error?.message || "Error interno" }, { status: 500 });
  }
}

// submit: envía la imagen + prompt a fal.ai (Kling 3.0 Pro I2V).
// Body: { image_url, prompt, duration, negative_prompt?, cfg_scale? }
// → { request_id, status }
async function doSubmit(body) {
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

  // Kling 3.0 Pro acepta duración 3-15s (como string).
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

  console.log("I2V submit:", { prompt: prompt.slice(0, 80), duration: dur });

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
    console.error("fal.ai submit error", res.status, errText);
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

// status: consulta el estado del job. Si COMPLETED, obtiene el video_url.
// Body: { request_id }
// → { status, video_url?, error? }
async function doStatus(body) {
  const apiKey = secrets.get("FAL_API_KEY");
  if (!apiKey) {
    return Response.json({ error: "FAL_API_KEY no configurada" }, { status: 500 });
  }

  const { request_id } = body;
  if (!request_id) return Response.json({ error: "Falta request_id" }, { status: 400 });

  const statusUrl = `${FAL_QUEUE_BASE}/requests/${request_id}/status`;
  const statusRes = await fetch(statusUrl, {
    headers: { Authorization: `Key ${apiKey}` },
  });

  if (!statusRes.ok) {
    const errText = await statusRes.text();
    console.error("fal.ai status error", statusRes.status, errText);
    return Response.json(
      { error: `fal.ai status error ${statusRes.status}: ${errText.slice(0, 300)}` },
      { status: 502 }
    );
  }

  const statusData = await statusRes.json();

  if (statusData.status === "COMPLETED") {
    // Obtiene el resultado (video URL).
    const resultUrl = `${FAL_QUEUE_BASE}/requests/${request_id}`;
    const resultRes = await fetch(resultUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (!resultRes.ok) {
      return Response.json({
        status: "COMPLETED",
        video_url: null,
        error: "No se pudo obtener el resultado",
      });
    }
    const resultData = await resultRes.json();
    const video_url = resultData?.data?.video?.url || null;
    const video_size = resultData?.data?.video?.file_size || 0;
    console.log("I2V completed:", { request_id, video_url: video_url?.slice(0, 60) });
    return Response.json({ status: "COMPLETED", video_url, video_size });
  }

  if (statusData.status === "FAILED") {
    const errMsg = statusData.error || statusData?.logs?.find((l) => l.level === "ERROR")?.message || "Generación fallida";
    console.error("I2V failed:", request_id, errMsg);
    return Response.json({ status: "FAILED", error: errMsg });
  }

  // IN_QUEUE o IN_PROGRESS
  return Response.json({ status: statusData.status || "IN_QUEUE" });
}