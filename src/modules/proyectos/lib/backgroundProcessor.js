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
  bulkCreateFingerprints,
  deleteFingerprintsByFolder,
  updateProject,
} from "../hooks/useProjectStore";
import { base44 } from "@/api/base44Client";

// Jobs activos en memoria: projectId -> job
const activeJobs = new Map();

export function getJob(projectId, folderId) {
  if (folderId) return activeJobs.get(`${projectId}:${folderId}`) || null;
  return activeJobs.get(projectId) || null;
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
  // Envía el estado actual inmediatamente.
  try { callback(snapshotJob(job)); } catch {}
  return () => { job.subscribers.delete(callback); };
}

function snapshotJob(job) {
  return {
    projectId: job.projectId,
    folderId: job.folderId,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    items: job.items,
    error: job.error,
    folderRef: job.folderRef,
  };
}

function notify(job) {
  const snap = snapshotJob(job);
  job.subscribers.forEach((cb) => { try { cb(snap); } catch {} });
}

// Inicia el procesado de una carpeta RAW. Devuelve el job inmediatamente (sin await).
// El procesado corre en segundo plano; los callbacks notifican progreso, completado
// y error. Si ya hay un job para el proyecto, solo añade el callback.
export function startProcessing({ folderHandle, files, folderName, folderId, projectId, existing, onProgress, onComplete, onError }) {
  let pid = projectId || existing?.projectId || null;

  if (pid && folderId && activeJobs.has(`${pid}:${folderId}`)) {
    const existing_job = activeJobs.get(`${pid}:${folderId}`);
    if (onProgress) existing_job.subscribers.add(onProgress);
    return existing_job;
  }

  const job = {
    projectId: pid,
    folderId: folderId || null,
    status: "processing",
    progress: { done: 0, total: 0 },
    phase: "extracting",
    items: [],
    error: null,
    folderRef: existing?.folderRef || "",
    subscribers: new Set(),
  };
  if (onProgress) job.subscribers.add(onProgress);

  // Fire-and-forget: el bucle corre independientemente del componente.
  runProcessing(folderHandle, files, folderName, folderId, pid, existing, job, onComplete, onError);

  return job;
}

async function runProcessing(folderHandle, files, folderName, folderId, pid, existing, job, onComplete, onError) {
  const jobKey = pid && folderId ? `${pid}:${folderId}` : pid;
  if (jobKey) activeJobs.set(jobKey, job);
  try {
    // 1. El proyecto debe existir antes de procesar una carpeta (se crea al
    //    crear el proyecto desde NuevoProyectoPage, no aquí).
    if (!pid) {
      throw new Error("No se puede procesar sin projectId: crea el proyecto antes de añadir carpetas.");
    }

    // 2. Crea o actualiza el ProjectFolder (carpeta/sesión independiente).
    //    Si folderId viene dado (añadir carpeta a proyecto existente), actualiza ese
    //    registro. Si no (crear proyecto nuevo), crea la carpeta aquí.
    if (!folderId) {
      const existingFolders = await base44.entities.ProjectFolder.filter({ project_id: pid }, "order_index", 200).catch(() => []);
      const folder = await base44.entities.ProjectFolder.create({
        project_id: pid,
        name: folderName || folderHandle?.name || "Carpeta",
        order_index: existingFolders.length,
        raw_folder_name: folderName || folderHandle?.name || "",
        raw_folder_handle_ref: folderHandle ? await saveHandle(folderHandle, "directory", { name: folderHandle.name }).catch(() => "") : "",
        photo_count: 0,
        import_status: "processing",
        selection_status: "pending",
        edit_status: "pending",
        last_modified: new Date().toISOString(),
      });
      folderId = folder.id;
      job.folderId = folderId;
      job.folderRef = folder.raw_folder_handle_ref;
    } else {
      job.folderRef = folderHandle ? await saveHandle(folderHandle, "directory", { name: folderHandle.name }).catch(() => "") : "";
      await base44.entities.ProjectFolder.update(folderId, {
        import_status: "processing",
        raw_folder_name: folderName || folderHandle?.name || "",
        raw_folder_handle_ref: job.folderRef,
        last_modified: new Date().toISOString(),
      }).catch(() => {});
    }
    notify(job);

    // 3. Crea el ProjectProcessingJob para el Historial.
    let jobId = null;
    let lastPct = -1;
    let lastPhase = null;
    const syncJob = async (progress, phase, status = "processing") => {
      try {
        if (!jobId) {
          const j = await base44.entities.ProjectProcessingJob.create({ project_id: pid, folder_id: folderId || "", status, progress, phase });
          jobId = j.id;
        } else if (status !== "processing" || Math.abs(progress - lastPct) >= 4 || phase !== lastPhase) {
          await base44.entities.ProjectProcessingJob.update(jobId, { status, progress, phase });
        }
        lastPct = progress;
        lastPhase = phase;
      } catch {}
    };

    // 4. Lee los RAW de la carpeta (RECURSIVO: traverse subdirectorios). Los
    //    fotógrafos suelen organizar las fotos en subcarpetas por momento
    //    (Ceremonia/, Retratos/, Fiesta/...); si solo se lee el nivel superior,
    //    estas carpetas no contienen archivos directamente y el procesado termina
    //    en silencio con 0 fotos.
    const raws = [];
    const seenPaths = new Set();
    if (files && files.length) {
      // Móvil: FileList de <input webkitdirectory> — sin handle de directorio.
      for (const file of files) {
        const name = file.name;
        if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
        const relPath = file.webkitRelativePath || name;
        if (!seenPaths.has(relPath)) {
          seenPaths.add(relPath);
          raws.push(file);
        }
      }
    } else if (folderHandle) {
      // Desktop: recorre el directorio recursivamente (subcarpetas por momento).
      async function collectRaws(dirHandle, prefix) {
        for await (const [name, entryHandle] of dirHandle.entries()) {
          if (entryHandle.kind === "directory") {
            if (isHiddenOrSystemFile(name)) continue;
            await collectRaws(entryHandle, prefix ? `${prefix}/${name}` : name);
            continue;
          }
          if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
          const file = await entryHandle.getFile();
          const relPath = prefix ? `${prefix}/${name}` : name;
          if (!seenPaths.has(relPath)) {
            seenPaths.add(relPath);
            try { Object.defineProperty(file, "webkitRelativePath", { value: relPath, writable: false, configurable: true }); } catch {}
            raws.push(file);
          }
        }
      }
      await collectRaws(folderHandle, "");
    }
    const count = raws.length;
    if (count === 0) {
      // Aviso claro: la carpeta no contiene RAW (ni en subcarpetas). Sin esto el
      // usuario ve una pantalla en blanco sin explicación.
      throw new Error("La carpeta seleccionada no contiene imágenes (RAW: CR2, CR3, NEF, ARW, DNG, RAF... o JPG/JPEG). Verifica que las fotos estén dentro de la carpeta o de sus subcarpetas.");
    }
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
        fingerprint: await computeFingerprint({ file: p.file, preview: p.preview, relativePath: p.file.webkitRelativePath || p.file.name }),
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
      // AISLAMIENTO POR CARPETA: solo se borran los fingerprints de la carpeta ACTIVA.
      // Nunca se borran los fingerprints de las demás carpetas del proyecto.
      // Si folderId no existe, es un error controlado: no se ejecuta ninguna eliminación.
      if (!folderId) {
        throw new Error("No se puede autoguardar sin folderId: la carpeta activa no está identificada.");
      }
      await deleteFingerprintsByFolder(folderId);
      await bulkCreateFingerprints(
        withFingerprint.map((p) => ({
          project_id: pid,
          folder_id: folderId || "",
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
      // Actualiza el ProjectFolder con el recuento final y estado de importación.
      if (folderId) {
        await base44.entities.ProjectFolder.update(folderId, {
          photo_count: withFingerprint.length,
          import_status: "completed",
          last_modified: new Date().toISOString(),
        }).catch(() => {});
      }
    } catch {}

    if (onComplete) try { onComplete(snapshotJob(job)); } catch {}

    // Limpia el job después de 2 minutos (tiempo suficiente para que el componente
    // lo lea al volver, pero sin retenerlo indefinidamente).
    setTimeout(() => {
      activeJobs.delete(jobKey || pid);
    }, 120000);
  } catch (e) {
    job.status = "failed";
    job.error = e?.message || String(e);
    notify(job);
    if (folderId) {
      await base44.entities.ProjectFolder.update(folderId, {
        import_status: "failed",
        last_modified: new Date().toISOString(),
      }).catch(() => {});
    }
    if (onError) try { onError(e); } catch {}
    setTimeout(() => {
      activeJobs.delete(jobKey || pid);
    }, 120000);
  }
}