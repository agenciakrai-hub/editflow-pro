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

import { groupIntoScenes, packSceneChunks } from "@/lib/rawaistudio/groupIntoScenes";
import { selectBursts } from "@/lib/ai/aiGateway";
import { selectionUpdates } from "./selectionPersistence";
import { getCachedPreviews, getCachedPreview, cachePreviews } from "./previewCache";
import { fileIdentity, pendingSelectionItems } from "./selectionResume";
import { prepareSelectionPreview } from "@/lib/rawaistudio/selectionPreviewValidation";
import { extractRawPreview } from "@/lib/rawaistudio/rawPreviewReader";
import { computePHash, phashHex } from "@/lib/rawaistudio/perceptualHash";
import { getHandleRecord } from "./idbHandles";
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
export function startAiSelection({ projectId, folderId, items, selectedIds, resumeFrom = null, onComplete, onProgress, onError }) {
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
    resumeFrom,
  };
  if (onProgress) job.subscribers.add(onProgress);
  activeJobs.set(key, job);

  runSelection(job, marked, onComplete, onError);
  return job;
}

async function runSelection(job, marked, onComplete, onError) {
  const key = `${job.projectId}:${job.folderId}`;
  let selJobId = null;
  let savedFingerprints;
  let savedFingerprintIds = new Set(job.resumeFrom?.stage_progress?.completed_fingerprint_ids || []);
  let targetFingerprintIds = [];
  let burstPlan = [];
  try {
    savedFingerprints = await listFingerprintsByFolder(job.folderId);
    if (job.resumeFrom) {
      const fresh = await base44.entities.AlbumAISelection.get(job.resumeFrom.id);
      if (fresh.stage_progress?.selection_version !== "burst-winner-v2") throw new Error("La selección anterior usa otro método. Usa «Rehacer por ráfagas» para comparar también las fotos ya analizadas.");
      burstPlan = fresh.stage_progress.burst_plan || [];
      if (!["failed", "canceled"].includes(fresh.status)) throw new Error("El trabajo anterior no está detenido");
      marked = pendingSelectionItems(job.items, savedFingerprints, fresh);
      savedFingerprintIds = new Set(fresh.stage_progress?.completed_fingerprint_ids || []);
      targetFingerprintIds = fresh.stage_progress?.target_fingerprint_ids || savedFingerprints.map(fp => fp.id);
    } else {
      const byKey = new Map(savedFingerprints.map(fp => [fileIdentity(fp), fp.id]));
      targetFingerprintIds = marked.map(it => byKey.get(fileIdentity(it)));
      if (targetFingerprintIds.some(id => !id)) throw new Error("No se pudo identificar cada archivo guardado");
    }
    if (!job.resumeFrom) {
      const ids = new Map(savedFingerprints.map(fp => [fileIdentity(fp),fp.id]));
      const enriched = marked.map(it => ({...it,fingerprint:savedFingerprints.find(fp=>fileIdentity(fp)===fileIdentity(it)) || it.fingerprint}));
      burstPlan = groupIntoScenes(enriched).map(group=>({id:group.id,photo_ids:group.files.map(it=>ids.get(fileIdentity(it)))}));
    }
    if (!marked.length) throw new Error("No quedan fotos pendientes en este trabajo");
    job.total = marked.length;
    notify(job);
  } catch (error) {
    job.status = "failed"; job.error = error.message; notify(job);
    onError?.(error); activeJobs.delete(key); return;
  }
  const checkpointProgress = () => ({
    selection_version: "burst-winner-v2",
    burst_plan: burstPlan,
    photos_done: savedFingerprintIds.size,
    completed_fingerprint_ids: [...savedFingerprintIds],
    target_fingerprint_ids: targetFingerprintIds,
  });

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
      stats: { photo_count: targetFingerprintIds.length, resumed_from: job.resumeFrom?.id || null, pending_at_start: marked.length },
      stage_progress: checkpointProgress(),
    });
    if (!j?.id) throw new Error("El servidor no devolvió la identidad del trabajo");
    selJobId = j.id;
    job.historyId = selJobId;
  } catch (error) {
    job.status = "failed";
    job.error = `No se pudo registrar la selección: ${error?.message || "Error"}`;
    notify(job);
    if (onError) onError(new Error(job.error));
    setTimeout(() => { if (activeJobs.get(key) === job) activeJobs.delete(key); }, 120000);
    return;
  }

  // Marca la carpeta como "selección en curso" para que la página del proyecto
  // refleje el estado aunque el usuario no esté en la página de la carpeta.
  await updateFolder(job.folderId, {
    selection_status: "in_progress",
    last_modified: new Date().toISOString(),
  }).catch(() => {});

  try {
    // Plan once over folder metadata; load previews only for whole bursts.
    const byFingerprint = new Map(savedFingerprints.map(fp=>[fp.id,fp]));
    const byFile = new Map(marked.map(it=>[fileIdentity(it),it]));
    const groups = [];
    for (const plan of burstPlan) {
      const pending = plan.photo_ids.filter(id=>!savedFingerprintIds.has(id));
      if (!pending.length) continue;
      if (pending.length!==plan.photo_ids.length) throw new Error("El punto de guardado contiene una ráfaga parcial. Se conserva para revisión.");
      const files = pending.map(id=>byFile.get(fileIdentity(byFingerprint.get(id) || {})));
      if (files.some(file=>!file)) throw new Error("Faltan archivos de una ráfaga pendiente");
      groups.push({id:plan.id,files});
    }
    const chunks = packSceneChunks(groups);

    const savedIds = new Set();
    const allKeep = new Set();
    const allMeta = new Map();
    let lastTrace = null;
    const traceChunks = [];
    const deferredServiceErrors = [];
    let originalDirectory;
    async function originalFile(item) {
      if (originalDirectory === undefined) {
        originalDirectory = null;
        try {
          const folder = await base44.entities.ProjectFolder.get(job.folderId);
          const record = await getHandleRecord(folder.raw_folder_handle_ref);
          if (await record?.handle?.queryPermission?.({ mode: "read" }) === "granted") originalDirectory = record.handle;
        } catch { /* Folder picker remains available when permission is absent. */ }
      }
      if (!originalDirectory) return null;
      try {
        const parts = (item.fingerprint?.relative_path || item.file?.name || "").split("/").filter(Boolean);
        if (parts[0] === originalDirectory.name) parts.shift();
        if (!parts.length || parts.some(part => part === ".." || part === ".")) return null;
        let directory = originalDirectory;
        for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
        const file = await (await directory.getFileHandle(parts.at(-1))).getFile();
        return file.size === Number(item.fingerprint?.file_size) ? file : null;
      } catch { return null; }
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      if (job.canceled) return;
      const chunk = chunks[ci];
      // Carga previews SOLO para este chunk desde IndexedDB.
      const chunkHashes = chunk.map((it) => it.fingerprint?.fingerprint_hash).filter(Boolean);
      let previewByHash = new Map();
      if (chunkHashes.length) {
        try { previewByHash = await getCachedPreviews(chunkHashes, { includeHiRes: false }); } catch {}
      }
      const aiItems = [];
      for (const it of chunk) {
        const pv = previewByHash.get(it.fingerprint?.fingerprint_hash);
        const dataUrl = pv?.dataUrl;
        let preview = pv?.base64
          ? pv
          : dataUrl
            ? { ...pv, dataUrl, base64: dataUrl.split(",")[1] || "", isPlaceholder: !!pv.isPlaceholder }
            : null;
        // Recover only unreadable thumbnails, without loading all high-res images.
        let prepared = await prepareSelectionPreview(preview, it.file, extractRawPreview);
        if (!prepared && it.fingerprint?.fingerprint_hash) {
          const full = await getCachedPreview(it.fingerprint.fingerprint_hash);
          prepared = await prepareSelectionPreview(full, it.file, extractRawPreview);
        }
        if (!prepared) {
          const original = await originalFile(it);
          if (original) prepared = await prepareSelectionPreview(null, original, extractRawPreview);
        }
        if (prepared) {
          if (prepared.dataUrl !== preview?.dataUrl) {
            const hash = phashHex(await computePHash(prepared.dataUrl));
            const fp = savedFingerprints.find(fp => fileIdentity(fp) === fileIdentity(it));
            if (!hash || !fp) throw new Error("No se pudo guardar la vista previa reparada");
            await cachePreviews([{ hash, ...prepared }]);
            await bulkUpdateFingerprints([{ id: fp.id, fingerprint_hash: hash }]);
            it.fingerprint = { ...it.fingerprint, fingerprint_hash: hash };
          }
          preview = prepared;
        }
        aiItems.push({
          id: it.id,
          selectionBurstId: it.selectionBurstId,
          file: it.file,
          fingerprint: it.fingerprint,
          preview,
          phash: it.phash || (it.fingerprint?.fingerprint_hash ? BigInt("0x" + it.fingerprint.fingerprint_hash) : null),
          captureTime: it.captureTime ?? it.fingerprint?.capture_time ?? null,
          cameraInfo: it.cameraInfo || { make: it.fingerprint?.camera_make, model: it.fingerprint?.camera_model },
          technical: it.technical || { sharpness: 0, exposureScore: 0.5, corrupt: false },
        });
      }

      const { keep, meta, trace, deferred_errors = [] } = await selectBursts(aiItems, () => {
        if (job.canceled) return;
        job.done = savedIds.size;
        notify(job);
      }, {
        shouldCancel: () => job.canceled,
        onBatch: async ({ meta: batchMeta }) => {
          if (job.canceled) return;
          const updates = selectionUpdates(batchMeta, marked, savedFingerprints);
          if (updates.length < batchMeta.size) throw new Error("No se pudo emparejar toda la ráfaga con las fotos guardadas");
          await bulkUpdateFingerprints(updates);
          for (const update of updates) savedFingerprintIds.add(update.id);
          for (const [id, result] of batchMeta) {
            savedIds.add(id);
            const selected = result.status === "SELECT" || result.status === "TOP_PICK";
            job.results.set(id, { status: result.status, rating: selected ? 5 : result.status === "REJECT" ? 0 : 3, aiReview: !selected && result.status !== "REJECT" });
          }
          job.done = savedIds.size;
          notify(job);
          await base44.entities.AlbumAISelection.update(selJobId, { stage_progress: checkpointProgress() });
        },
      });
      if (job.canceled) return;

      deferredServiceErrors.push(...deferred_errors);
      for (const id of keep) allKeep.add(id);
      for (const [id, m] of meta) allMeta.set(id, m);
      if (trace) { lastTrace = trace; traceChunks.push(trace); }
      job.done = savedIds.size;
      notify(job);
      // Libera las previews de este chunk (permite GC).
      previewByHash = null;
    }

    if (deferredServiceErrors.length) {
      const pendingCount = targetFingerprintIds.length - savedFingerprintIds.size;
      const error = new Error(`Se guardaron ${savedFingerprintIds.size} fotos; quedan ${pendingCount} pendientes por fallos del proveedor. Usa «Continuar selección pendiente». ${deferredServiceErrors[0].message}`);
      error.selectionDiagnostics = { ...deferredServiceErrors[0].selectionDiagnostics, deferred_bursts: deferredServiceErrors.length, pending_count: pendingCount };
      throw error;
    }
    // Construye el mapa de resultados: photoId -> { status, rating, aiReview }
    // y fingerprint_hash -> resultado (para auto-guardar en la BD).
    const resultsById = new Map();
    for (const it of marked) {
      const m = allMeta.get(it.id);
      if (!m) continue;
      const status = m.status || (allKeep.has(it.id) ? "SELECT" : "REVIEW");
      const aiSelected = status === "SELECT" || status === "TOP_PICK";
      const review = !aiSelected && status !== "REJECT";
      const rating = aiSelected ? 5 : review ? 3 : 0;
      const result = { status, rating, aiReview: review };
      resultsById.set(it.id, result);

    }
    job.results = resultsById;
    const updates = selectionUpdates(allMeta, marked, savedFingerprints);
    if (updates.length < marked.length) throw new Error("La selección terminó sin guardar todas las fotos");
    // Cobertura excepcional de previews no disponibles y coherencia final del lote.
    await bulkUpdateFingerprints(updates);
    const selCount = updates.filter(u => u.rating === 5).length;
    await updateFolder(job.folderId, { selection_status: selCount > 0 ? "completed" : "pending", last_modified: new Date().toISOString() });
    await base44.entities.AlbumAISelection.update(selJobId, {
      status: "completed", stage: "done", stage_progress: checkpointProgress(),
      stats: { photo_count: targetFingerprintIds.length, resumed_from: job.resumeFrom?.id || null, provider_used: lastTrace?.provider || null },
    });
    job.status = "completed";
    notify(job);

    // Guarda la traza de la ejecución en el proyecto.
    if (lastTrace && job.projectId) {
      updateProject(job.projectId, { ai_config_snapshot: { selection_trace: { ...lastTrace, photo_count: marked.length, chunks: traceChunks } } }).catch(() => {});
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
          stage_progress: checkpointProgress(),
          stats: { photo_count: targetFingerprintIds.length, resumed_from: job.resumeFrom?.id || null, ...(e?.selectionDiagnostics || {}) },
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
    if (activeJobs.get(key) === job) activeJobs.delete(key);
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
  if (job.historyId) base44.entities.AlbumAISelection.update(job.historyId, { status: "canceled", error: "Cancelado por el usuario" }).catch(() => {});
  // Revierte el estado de selección de la carpeta al cancelar.
  updateFolder(job.folderId, {
    selection_status: "pending",
    last_modified: new Date().toISOString(),
  }).catch(() => {});
  // Limpia inmediatamente: no retiene un job cancelado en memoria.
  setTimeout(() => { if (activeJobs.get(key) === job) activeJobs.delete(key); }, 5000);
}