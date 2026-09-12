// Procesador de proyectos en segundo plano.
//
// Extrae previews y calcula huellas de una carpeta RAW de forma INDEPENDIENTE al
// ciclo de vida del componente NuevoProyectoPage. Aunque el usuario navegue fuera
// de la página (a Selección, Edición, Historial, etc.), el procesado CONTINÚA:
// el bucle async vive en este módulo, no en el componente.
//
// Cuando termina, guarda automáticamente las huellas en la base de datos y cachea
// las previews en IndexedDB, de modo que el usuario no pierde su trabajo aunque
// haya cerrado la página.

import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { computeFingerprint } from "./projectFingerprint";
import { saveHandle } from "./idbHandles";
import { cachePreviews } from "./previewCache";
import {
  createProject,
  createCatalogBinding,
  bulkCreateFingerprints,
  deleteFingerprintsByProject,
  updateProject,
} from "../hooks/useProjectStore";
import { base44 } from "@/api/base44Client";

// Jobs activos en memoria: projectId -> job
const activeJobs = new Map();

export function getJob(projectId) {
  return activeJobs.get(projectId) || null;
}

export function getActiveJobIds() {
  return Array.from(activeJobs.keys());
}

// Suscribe un callback a las actualizaciones de un job. Devuelve la función de
// des-suscripción. Si el job no existe, devuelve un no-op.
export function subscribe(projectId, callback) {
  const job = activeJobs.get(projectId);
  if (!job) return () => {};
  job.subscribers.add(callback);
  // Envía el estado actual inmediatamente.
  try { callback(snapshotJob(job)); } catch {}
  return () => { job.subscribers.delete(callback); };
}

function snapshotJob(job) {
  return {
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    items: job.items,
    error: job.error,
    bindingId: job.bindingId,
    folderRef: job.folderRef,
    catalogRef: job.catalogRef,
  };
}

function notify(job) {
  const snap = snapshotJob(job);
  job.subscribers.forEach((cb) => { try { cb(snap); } catch {} });
}

// Inicia el procesado de una carpeta RAW. Devuelve el job inmediatamente (sin await).
// El procesado corre en segundo plano; los callbacks notifican progreso, completado
// y error. Si ya hay un job para el proyecto, solo añade el callback.
export function startProcessing({ folderHandle, catalogHandle, projectId, existing, onProgress, onComplete, onError }) {
  let pid = projectId || existing?.projectId || null;

  if (pid && activeJobs.has(pid)) {
    const existing_job = activeJobs.get(pid);
    if (onProgress) existing_job.subscribers.add(onProgress);
    return existing_job;
  }

  const job = {
    projectId: pid,
    status: "processing",
    progress: { done: 0, total: 0 },
    phase: "extracting",
    items: [],
    error: null,
    bindingId: existing?.bindingId || null,
    folderRef: existing?.folderRef || "",
    catalogRef: existing?.catalogRef || "",
    subscribers: new Set(),
  };
  if (onProgress) job.subscribers.add(onProgress);

  // Fire-and-forget: el bucle corre independientemente del componente.
  runProcessing(folderHandle, catalogHandle, pid, existing, job, onComplete, onError);

  return job;
}

async function runProcessing(folderHandle, catalogHandle, pid, existing, job, onComplete, onError) {
  try {
    // 1. Crea el proyecto si no existe.
    if (!pid) {
      const p = await createProject({ title: folderHandle.name, status: "draft", photo_count: 0 });
      pid = p.id;
      job.projectId = pid;
      activeJobs.set(pid, job);
      notify(job);
    } else {
      activeJobs.set(pid, job);
    }

    // 2. Guarda el handle de la carpeta y crea el binding del catálogo.
    const folderRef = await saveHandle(folderHandle, "directory", { name: folderHandle.name }).catch(() => "");
    const catalogRef = catalogHandle
      ? await saveHandle(catalogHandle, "file", { name: catalogHandle.name }).catch(() => "")
      : null;
    job.folderRef = folderRef;
    job.catalogRef = catalogRef;
    try {
      const binding = await createCatalogBinding({
        project_id: pid,
        catalog_handle_ref: catalogRef || "",
        raw_folder_handle_ref: folderRef || "",
        catalog_filename: catalogHandle?.name || "",
        raw_folder_name: folderHandle.name,
      });
      job.bindingId = binding?.id || null;
    } catch {}
    notify(job);

    // 3. Crea el ProjectProcessingJob para el Historial.
    let jobId = null;
    let lastPct = -1;
    let lastPhase = null;
    const syncJob = async (progress, phase, status = "processing") => {
      try {
        if (!jobId) {
          const j = await base44.entities.ProjectProcessingJob.create({ project_id: pid, status, progress, phase });
          jobId = j.id;
        } else if (status !== "processing" || Math.abs(progress - lastPct) >= 4 || phase !== lastPhase) {
          await base44.entities.ProjectProcessingJob.update(jobId, { status, progress, phase });
        }
        lastPct = progress;
        lastPhase = phase;
      } catch {}
    };

    // 4. Lee los RAW de la carpeta.
    const raws = [];
    for await (const [name, entryHandle] of folderHandle.entries()) {
      if (entryHandle.kind !== "file") continue;
      if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
      raws.push(await entryHandle.getFile());
    }
    const count = raws.length;
    const total = count * 2;
    job.progress = { done: 0, total };
    notify(job);
    await syncJob(0, "extracting");

    // 5. Extrae previews embebidas.
    const inputItems = raws.map((f, i) => ({ id: String(i), file: f }));
    let withPreview = [];
    try {
      withPreview = await extractPreviews(
        inputItems,
        (done) => {
          job.progress = { done, total };
          notify(job);
          syncJob(total ? Math.round((done / total) * 100) : 0, "extracting");
        },
        () => {}
      );
    } catch (e) {
      await syncJob(lastPct < 0 ? 0 : lastPct, lastPhase || "extracting", "failed");
      throw e;
    }

    // 6. Calcula huellas digitales.
    job.phase = "fingerprinting";
    notify(job);
    const withFingerprint = [];
    for (let i = 0; i < withPreview.length; i++) {
      const p = withPreview[i];
      withFingerprint.push({
        ...p,
        status: "REVIEW",
        rating: 0,
        fingerprint: await computeFingerprint({ file: p.file, preview: p.preview, relativePath: p.file.name }),
      });
      const done = count + i + 1;
      job.progress = { done, total };
      notify(job);
      syncJob(total ? Math.round((done / total) * 100) : 0, "fingerprinting");
    }

    // 7. Completa el job en la base de datos.
    await syncJob(100, "fingerprinting", "completed");
    job.status = "completed";
    job.progress = { done: total, total };
    job.items = withFingerprint;
    notify(job);

    // 8. Cachea previews en IndexedDB (para reabrir el proyecto al instante).
    cachePreviews(
      withFingerprint.map((p) => ({
        hash: p.fingerprint?.fingerprint_hash,
        dataUrl: p.preview?.dataUrl,
        hiResDataUrl: p.preview?.hiResDataUrl,
      }))
    ).catch(() => {});

    // 9. Auto-guarda huellas en la base de datos (para que no se pierdan si el
    //    usuario navegó fuera durante el procesado).
    try {
      await deleteFingerprintsByProject(pid);
      await bulkCreateFingerprints(
        withFingerprint.map((p) => ({
          project_id: pid,
          fingerprint_hash: p.fingerprint.fingerprint_hash,
          filename: p.fingerprint.filename,
          relative_path: p.fingerprint.relative_path,
          capture_time: p.fingerprint.capture_time,
          camera_make: p.fingerprint.camera_make,
          camera_model: p.fingerprint.camera_model,
          file_size: p.fingerprint.file_size,
          selection_status: "REVIEW",
          marked: true,
          rating: 0,
          color_label: "none",
        }))
      );
      await updateProject(pid, { photo_count: withFingerprint.length }).catch(() => {});
    } catch {}

    if (onComplete) try { onComplete(snapshotJob(job)); } catch {}

    // Limpia el job después de 2 minutos (tiempo suficiente para que el componente
    // lo lea al volver, pero sin retenerlo indefinidamente).
    setTimeout(() => {
      activeJobs.delete(pid);
    }, 120000);
  } catch (e) {
    job.status = "failed";
    job.error = e?.message || String(e);
    notify(job);
    if (onError) try { onError(e); } catch {}
    setTimeout(() => {
      activeJobs.delete(pid);
    }, 120000);
  }
}