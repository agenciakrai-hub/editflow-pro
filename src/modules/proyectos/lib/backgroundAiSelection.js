// Selección IA en segundo plano, INDEPENDIENTE del ciclo de vida del componente.
//
// Cuando el usuario navega fuera de NuevoProyectoPage (a Mis proyectos, Selección,
// Edición, crear otro proyecto...), la selección CONTINÚA: el bucle async vive en
// este módulo, no en el componente.
//
// Al terminar, guarda automáticamente los resultados en la base de datos (fingerprints
// con el nuevo estado/rating/label) y actualiza el job de AlbumAISelection. Cuando el
// usuario vuelve a la página, el componente se suscribe al job y muestra el progreso
// en vivo, o los resultados ya guardados si terminó mientras estaba fuera.

import { selectBursts } from "@/lib/ai/aiGateway";
import { statusMeta } from "./projectFingerprint";
import {
  listFingerprintsByFolder,
  bulkUpdateFingerprints,
  updateFolder,
  updateProject,
} from "../hooks/useProjectStore";
import { base44 } from "@/api/base44Client";

// Jobs activos en memoria: `${projectId}:${folderId}` -> job
const activeJobs = new Map();

export function getJob(projectId, folderId) {
  if (folderId) return activeJobs.get(`${projectId}:${folderId}`) || null;
  for (const [key, job] of activeJobs) {
    if (key.startsWith(`${projectId}:`)) return job;
  }
  return null;
}

export function getActiveJobIds() {
  return Array.from(activeJobs.keys());
}

// Suscribe un callback a las actualizaciones de un job. Devuelve la función de
// des-suscripción. Si el job no existe, devuelve un no-op.
export function subscribe(projectId, folderId, callback) {
  const job = getJob(projectId, folderId);
  if (!job) return () => {};
  job.subscribers.add(callback);
  try { callback(snapshotJob(job)); } catch {}
  return () => { job.subscribers.delete(callback); };
}

function snapshotJob(job) {
  return {
    projectId: job.projectId,
    folderId: job.folderId,
    status: job.status,
    done: job.done,
    total: job.total,
    results: job.results,
    error: job.error,
  };
}

function notify(job) {
  const snap = snapshotJob(job);
  job.subscribers.forEach((cb) => { try { cb(snap); } catch {} });
}

// Inicia la selección IA en segundo plano. Devuelve el job inmediatamente (sin await).
// El procesado corre en segundo plano; los callbacks notifican progreso, completado
// y error. Si ya hay un job running para la carpeta, solo añade el callback.
export function startAiSelection({ projectId, folderId, items, selectedIds, onComplete, onProgress, onError }) {
  const key = `${projectId}:${folderId}`;
  const existing = activeJobs.get(key);
  if (existing && existing.status === "running") {
    if (onProgress) existing.subscribers.add(onProgress);
    return existing;
  }

  const marked = items.filter((it) => selectedIds.has(it.id));

  const job = {
    projectId,
    folderId,
    status: "running",
    done: 0,
    total: marked.length,
    results: new Map(),
    error: null,
    canceled: false,
    subscribers: new Set(),
    items: marked,
  };
  if (onProgress) job.subscribers.add(onProgress);
  activeJobs.set(key, job);

  runSelection(job, marked, onComplete, onError);
  return job;
}

async function runSelection(job, marked, onComplete, onError) {
  const key = `${job.projectId}:${job.folderId}`;
  let selJobId = null;

  // Cancela jobs "running" anteriores de esta carpeta en la base de datos.
  try {
    await base44.entities.AlbumAISelection.updateMany(
      { project_id: job.projectId, folder_id: job.folderId, status: "running" },
      { $set: { status: "canceled", error: "Reemplazado por una nueva selección" } }
    );
  } catch {}

  // Crea el job de AlbumAISelection para el Historial.
  try {
    const j = await base44.entities.AlbumAISelection.create({
      project_id: job.projectId,
      folder_id: job.folderId,
      status: "running",
      stage: "e2",
      stats: { photo_count: marked.length },
    });
    selJobId = j.id;
  } catch {}

  // Marca la carpeta como "selección en curso" para que la página del proyecto
  // refleje el estado aunque el usuario no esté en la página de la carpeta.
  await updateFolder(job.folderId, {
    selection_status: "in_progress",
    last_modified: new Date().toISOString(),
  }).catch(() => {});

  try {
    const aiItems = marked.map((it) => {
      const dataUrl = it.preview?.dataUrl;
      const preview = it.preview?.base64
        ? it.preview
        : dataUrl
          ? { dataUrl, base64: dataUrl.split(",")[1] || "", isPlaceholder: false }
          : null;
      return {
        id: it.id,
        file: it.file,
        preview,
        phash: it.phash || (it.fingerprint?.fingerprint_hash ? BigInt("0x" + it.fingerprint.fingerprint_hash) : null),
        captureTime: it.captureTime ?? it.fingerprint?.capture_time ?? null,
        cameraInfo: it.cameraInfo || { make: it.fingerprint?.camera_make, model: it.fingerprint?.camera_model },
        technical: it.technical || { sharpness: 0, exposureScore: 0.5, corrupt: false },
      };
    });

    const { keep, meta, trace } = await selectBursts(aiItems, (d, t) => {
      if (job.canceled) return;
      job.done = d;
      if (typeof t === "number") job.total = t;
      notify(job);
    });

    if (job.canceled) return;

    // Construye el mapa de resultados: photoId -> { status, rating, aiReview }
    // y fingerprint_hash -> resultado (para auto-guardar en la BD).
    const resultsById = new Map();
    const resultsByHash = new Map();
    for (const it of marked) {
      const m = meta.get(it.id);
      if (!m) continue;
      const status = m.status || (keep.has(it.id) ? "SELECT" : "REVIEW");
      const aiSelected = status === "SELECT" || status === "TOP_PICK";
      const review = !aiSelected && status !== "REJECT";
      const rating = aiSelected ? 5 : review ? 3 : 0;
      const result = { status, rating, aiReview: review };
      resultsById.set(it.id, result);
      const hash = it.fingerprint?.fingerprint_hash;
      if (hash) resultsByHash.set(hash, result);
    }
    job.results = resultsById;
    job.status = "completed";
    notify(job);

    // Actualiza el job en la base de datos.
    if (selJobId) {
      try {
        await base44.entities.AlbumAISelection.update(selJobId, {
          status: "completed",
          stage: "done",
          stats: { photo_count: marked.length, provider_used: trace?.provider || null },
        });
      } catch {}
    }

    // AUTO-GUARDA los resultados en los fingerprints: el usuario no necesita volver
    // a la página ni pulsar «Guardar» para que la selección IA persista. Empareja
    // por fingerprint_hash (no por id) para funcionar tanto si las fotos vinieron
    // de la BD como del backgroundProcessor.
    try {
      const fps = await listFingerprintsByFolder(job.folderId);
      const updates = [];
      for (const fp of fps) {
        const result = resultsByHash.get(fp.fingerprint_hash);
        if (!result) continue;
        const sm = statusMeta(result.status, result.rating);
        updates.push({
          id: fp.id,
          selection_status: result.status,
          rating: result.rating,
          color_label: result.aiReview ? "yellow" : sm.color_label,
        });
      }
      if (updates.length > 0) await bulkUpdateFingerprints(updates);
      const selCount = updates.filter((u) => u.selection_status === "SELECT" || u.selection_status === "TOP_PICK").length;
      await updateFolder(job.folderId, {
        selection_status: selCount > 0 ? "completed" : "pending",
        last_modified: new Date().toISOString(),
      }).catch(() => {});
    } catch {}

    // Guarda la traza de la ejecución en el proyecto.
    if (trace && job.projectId) {
      updateProject(job.projectId, { ai_config_snapshot: { selection_trace: trace } }).catch(() => {});
    }

    if (onComplete) try { onComplete(snapshotJob(job)); } catch {}
  } catch (e) {
    if (job.canceled) return;
    job.status = "failed";
    job.error = e?.message || String(e);
    notify(job);
    if (selJobId) {
      try {
        await base44.entities.AlbumAISelection.update(selJobId, {
          status: "failed",
          error: String(e?.message || "Error").slice(0, 500),
        });
      } catch {}
    }
    // Revierte el estado de selección de la carpeta si la selección falló.
    await updateFolder(job.folderId, {
      selection_status: "pending",
      last_modified: new Date().toISOString(),
    }).catch(() => {});
    if (onError) try { onError(e); } catch {}
  }

  // Limpia el job después de 2 minutos (tiempo suficiente para que el componente
  // lo lea al volver, pero sin retenerlo indefinidamente).
  setTimeout(() => {
    activeJobs.delete(key);
  }, 120000);
}

// Cancela un job de selección IA en segundo plano. Marca el job como "canceled" en
// memoria; el bucle async ignora los resultados al detectar el flag. El proceso
// subyacente (selectBursts) no se puede detener, pero sus resultados se descartan.
export function cancelSelection(projectId, folderId) {
  const key = `${projectId}:${folderId}`;
  const job = activeJobs.get(key);
  if (!job) return;
  job.canceled = true;
  job.status = "canceled";
  notify(job);
  // Revierte el estado de selección de la carpeta al cancelar.
  updateFolder(job.folderId, {
    selection_status: "pending",
    last_modified: new Date().toISOString(),
  }).catch(() => {});
  // Limpia inmediatamente: no retiene un job cancelado en memoria.
  setTimeout(() => { activeJobs.delete(key); }, 5000);
}