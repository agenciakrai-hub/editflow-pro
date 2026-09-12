import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, FileText, Loader2, ArrowLeft, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
// Solo IMPORTA (no modifica) utilidades del motor de Selección existente.
import { selectBursts } from "@/lib/ai/aiGateway";
import { statusMeta, SELECTION_CYCLE } from "./lib/projectFingerprint";
import { saveHandle, getHandleRecord } from "./lib/idbHandles";
import { createProject, createCatalogBinding, bulkCreateFingerprints, getProject, getCatalogBinding, listFingerprints, updateProject, updateCatalogBinding, deleteFingerprintsByProject } from "./hooks/useProjectStore";
import { startProcessing, getJob, subscribe } from "./lib/backgroundProcessor";
import ProjectPhotoWorkspace from "./components/ProjectPhotoWorkspace";
import { useToast } from "@/components/ui/use-toast";
import useUndoRedo from "@/hooks/useUndoRedo";
import { setPendingProjectPreviews, setSession } from "@/lib/rawaistudio/localSession";
import { getCachedPreviews } from "./lib/previewCache";

// Crea un proyecto: nombre + fecha + catálogo .lrcat + carpeta RAW. Lee los RAW igual que
// el flujo de Selección (extractPreviews, reutilizado sin modificar) y calcula un
// fingerprint por foto. La selección aquí es manual (toca la tarjeta para cambiar estado) —
// no invoca el motor de selección IA, por diseño aditivo.
export default function NuevoProyectoPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [catalogHandle, setCatalogHandle] = useState(null);
  const [folderHandle, setFolderHandle] = useState(null);
  const [items, setItems] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  // Acción en curso («save», «seleccion», «editar», «album»): SOLO el botón
  // pulsado muestra su spinner; el resto queda deshabilitado pero sin girar.
  const [busyAction, setBusyAction] = useState(null);
  // Selección IA EN LA MISMA PÁGINA: corre SOLO sobre las fotos marcadas (checkbox).
  const [aiRunning, setAiRunning] = useState(false);
  const [aiDone, setAiDone] = useState(0);
  const [aiTotal, setAiTotal] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [phase, setPhase] = useState("extracting");
  // Selección múltiple para eliminar + densidad del grid.
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [gridCols, setGridCols] = useState(5);
  // Historial deshacer/rehacer (⌘Z / ⌘Y) de los cambios en la galería: selección
  // (individual, rango con Mayús, todas), estados y eliminaciones. Cada acción
  // registra un paso ANTES de aplicarse. El guardado no se deshace.
  const itemsRef = useRef(items); itemsRef.current = items;
  // Traza de la última ejecución de selección IA. Viaja con el propio guardado del
  // proyecto (create/update), de modo que no dependa de una escritura aislada.
  const lastTraceRef = useRef(null);
  // Fiabilidad: evita actualizar estado en un componente desmontado (causa "error 5"
  // y warnings de React cuando el usuario navega fuera durante la selección IA).
  const mountedRef = useRef(true);
  // ID del job de selección IA en curso, para poder cancelarlo si el usuario
  // abandona la página a mitad de proceso.
  const currentSelJobIdRef = useRef(null);
  const selectedRef = useRef(selectedIds); selectedRef.current = selectedIds;
  const getSnapshot = useCallback(() => ({ items: itemsRef.current, selectedIds: selectedRef.current }), []);
  const applySnapshot = useCallback((s) => { setItems(s.items); setSelectedIds(s.selectedIds); }, []);
  const { record, reset, undo, redo, canUndo, canRedo } = useUndoRedo({ getSnapshot, applySnapshot });
  // Reabrir un proyecto existente: «Abrir» (Mis proyectos) llega con ?project=<id> y
  // carga en ESTA MISMA página los datos guardados — nombre, fecha, catálogo/carpeta
  // y las fotos con sus estados — para continuar exactamente donde se dejó.
  const projectIdParam = new URLSearchParams(window.location.search).get("project");
  const [existing, setExisting] = useState(null);
  const [restoredHandles, setRestoredHandles] = useState({ folder: null, catalog: null });

  // Fiabilidad: al desmontar la página (navegar fuera, ir atrás, cambiar de herramienta),
  // se marca el job de selección IA en curso como "canceled" para que no quede colgado
  // en "running" para siempre. Al volver, la página no se bloquea mostrando un spinner
  // muerto. También se marca el componente como desmontado para evitar updates de estado.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const jobId = currentSelJobIdRef.current;
      if (jobId) {
        base44.entities.AlbumAISelection.update(jobId, {
          status: "canceled",
          error: "Cancelado: el usuario abandonó la página",
        }).catch(() => {});
        currentSelJobIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!projectIdParam) return;
    // Si hay un job activo (procesando en segundo plano), se suscribe a él en vez
    // de cargar desde la base de datos: el usuario ve el progreso en tiempo real
    // aunque haya navegado fuera y vuelto.
    const activeJob = getJob(projectIdParam);
    if (activeJob) {
      setExtracting(activeJob.status === "processing");
      setPhase(activeJob.phase);
      setProgress(activeJob.progress);
      if (activeJob.status === "completed" && activeJob.items?.length) {
        const loaded = activeJob.items.map((p) => ({
          id: p.id, file: p.file, status: p.status || "REVIEW", rating: p.rating || 0,
          aiReview: false, fingerprint: p.fingerprint, preview: p.preview,
        }));
        setItems(loaded);
        setSelectedIds(new Set(loaded.map((p) => p.id)));
      }
      const unsub = subscribe(projectIdParam, (job) => {
        setExtracting(job.status === "processing");
        setPhase(job.phase);
        setProgress(job.progress);
        if (job.status === "completed" && job.items?.length) {
          const loaded = job.items.map((p) => ({
            id: p.id, file: p.file, status: p.status || "REVIEW", rating: p.rating || 0,
            aiReview: false, fingerprint: p.fingerprint, preview: p.preview,
          }));
          setItems(loaded);
          setSelectedIds(new Set(loaded.map((p) => p.id)));
          reset();
        }
      });
      return unsub;
    }
    let alive = true;
    (async () => {
      try {
        const [p, b, fps] = await Promise.all([getProject(projectIdParam), getCatalogBinding(projectIdParam), listFingerprints(projectIdParam)]);
        if (!alive) return;
        setTitle(p?.title || "");
        setEventDate(p?.event_date || "");
        setExisting({
          projectId: projectIdParam,
          bindingId: b?.id || null,
          folderRef: b?.raw_folder_handle_ref || "",
          catalogRef: b?.catalog_handle_ref || "",
          folderName: b?.raw_folder_name || "",
          catalogName: b?.catalog_filename || "",
        });
        // Restaura los handles locales (mismo navegador) para seguir trabajando sin
        // volver a elegir carpeta/catálogo.
        try {
          const restores = { folder: null, catalog: null };
          if (b?.catalog_handle_ref) {
            const rec = await getHandleRecord(b.catalog_handle_ref);
            if (rec?.handle) { setCatalogHandle(rec.handle); restores.catalog = rec.handle; }
          }
          if (b?.raw_folder_handle_ref) {
            const rec = await getHandleRecord(b.raw_folder_handle_ref);
            if (rec?.handle) { setFolderHandle(rec.handle); restores.folder = rec.handle; }
          }
          setRestoredHandles(restores);
        } catch {}
        // Previews cacheadas en IndexedDB: la galería se ve al instante.
        let previewByHash = new Map();
        try { previewByHash = await getCachedPreviews(fps.map((f) => f.fingerprint_hash).filter(Boolean)); } catch {}
        const loaded = fps.map((f) => {
          const cached = previewByHash.get(f.fingerprint_hash);
          return {
            id: f.id,
            file: { name: f.filename },
            status: f.selection_status || "REVIEW",
            rating: f.rating || 0, // estrellas guardadas (apagadas si no se tocó)
            aiReview: f.color_label === "yellow", // restaura el amarillo de la IA
            fingerprint: f,
            // Restaura AMBAS resoluciones: lo (800px, galería) y hi (2400px, visor).
            preview: cached ? { dataUrl: cached.dataUrl, hiResDataUrl: cached.hiResDataUrl } : null,
          };
        });
        if (!alive) return;
        setItems(loaded);
        // La marca (checkbox) se guarda por foto: el proyecto se reabre EXACTAMENTE
        // como se dejó (fotos desmarcadas incluidas). Registros antiguos sin el
        // campo marcado → todas marcadas (comportamiento original).
        setSelectedIds(new Set(loaded.filter((it) => it.fingerprint.marked !== false).map((it) => it.id)));
      } catch (e) {
        toast({ title: "No se pudo abrir el proyecto", description: e?.message, variant: "destructive" });
      }
    })();
    return () => { alive = false; };
  }, [projectIdParam]);

  // Detecta una selección IA en curso al reabrir el proyecto (el usuario pudo
  // navegar fuera y volver). Sondea el job de AlbumAISelection hasta que termina
  // y entonces oculta la barra y avisa al usuario.
  useEffect(() => {
    if (!projectIdParam) return;
    let alive = true;
    let pollTimer = null;

    const checkAndPoll = async () => {
      try {
        const jobs = await base44.entities.AlbumAISelection.filter(
          { project_id: projectIdParam, status: "running" },
          "-created_date",
          1
        );
        if (!alive || !jobs?.length) return;
        const job = jobs[0];
        // Fiabilidad: si el job lleva "running" más de 30 min sin actualizarse, es un
        // job stale (el usuario navegó fuera a mitad de proceso y el trabajo se
        // abandonó). Se cancela automáticamente para que la página no se quede
        // bloqueada mostrando un spinner muerto al volver.
        const STALE_MS = 30 * 60 * 1000;
        const age = Date.now() - new Date(job.created_date).getTime();
        if (age > STALE_MS) {
          try {
            await base44.entities.AlbumAISelection.update(job.id, {
              status: "canceled",
              error: "Cancelado automáticamente: el trabajo estaba parado",
            });
          } catch {}
          if (!alive) return;
          toast({ title: "Selección IA cancelada", description: "El trabajo anterior estaba parado. Vuelve a lanzar la selección si lo necesitas." });
          return;
        }
        currentSelJobIdRef.current = job.id;
        setAiRunning(true);
        setBusyAction("seleccion");
        setAiTotal(job.stats?.photo_count || 0);
        setAiDone(0);
        pollTimer = setInterval(async () => {
          try {
            const updated = await base44.entities.AlbumAISelection.get(job.id);
            if (!alive) return;
            if (["completed", "failed", "canceled"].includes(updated.status)) {
              setAiRunning(false);
              setBusyAction(null);
              if (pollTimer) clearInterval(pollTimer);
              if (updated.status === "completed") {
                toast({ title: "Selección IA completada" });
              } else {
                toast({ title: "Selección IA no completada", description: updated.error || "Cancelada", variant: "destructive" });
              }
            }
          } catch {}
        }, 4000);
      } catch {}
    };

    checkAndPoll();
    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [projectIdParam]);

  const pickCatalog = async () => {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Catálogo Lightroom", accept: { "application/octet-stream": [".lrcat"] } }],
      });
      setCatalogHandle(handle);
    } catch {
      // Usuario canceló el selector — no es un error.
    }
  };

  // Inicia el procesado en segundo plano: extrae previews y calcula huellas de la
  // carpeta RAW. El bucle vive en backgroundProcessor.js, NO en este componente, así
  // que CONTINÚA aunque el usuario navegue fuera de esta página (a Selección, Edición,
  // Historial, etc.). Al completarse, guarda huellas en la base de datos y cachea
  // previews en IndexedDB automáticamente.
  const extractFromFolder = (handle) => {
    setExtracting(true);
    setPhase("extracting");
    setProgress({ done: 0, total: 0 });
    startProcessing({
      folderHandle: handle,
      catalogHandle,
      projectId: projectIdParam || existing?.projectId || null,
      existing,
      onProgress: (job) => {
        setPhase(job.phase);
        setProgress(job.progress);
        // Si el procesador creó el proyecto (nuevo), actualiza `existing` y la URL
        // para que el componente sepa que el proyecto ya existe.
        if (job.projectId && !existing && !projectIdParam) {
          setExisting({
            projectId: job.projectId,
            bindingId: job.bindingId || null,
            folderRef: job.folderRef || "",
            catalogRef: job.catalogRef || "",
            folderName: handle.name,
            catalogName: catalogHandle?.name || "",
          });
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("project", job.projectId);
            window.history.replaceState({}, "", url.toString());
          } catch {}
        }
      },
      onComplete: (job) => {
        setExtracting(false);
        const loaded = job.items.map((p) => ({
          id: p.id,
          file: p.file,
          status: p.status || "REVIEW",
          rating: p.rating || 0,
          aiReview: false,
          fingerprint: p.fingerprint,
          preview: p.preview,
        }));
        setItems(loaded);
        setSelectedIds(new Set(loaded.map((p) => p.id)));
        reset();
      },
      onError: (e) => {
        setExtracting(false);
        toast({ title: "Error en el procesado", description: e?.message, variant: "destructive" });
      },
    });
  };

  const pickFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker();
      setFolderHandle(handle);
      await extractFromFolder(handle);
    } catch {
      // Usuario canceló el selector — no es un error.
    }
  };

  const cycleStatus = (id) => {
    record();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: SELECTION_CYCLE[it.status] || "REVIEW" } : it)));
  };

  // Estrellas por foto: nacen apagadas (0); pulsar la n-ésima la enciende y pulsar la
  // misma de nuevo la apaga. Se guarda con el proyecto y viaja al XMP (xmp:Rating).
  const setRating = (id, rating) => {
    record();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, rating } : it)));
  };

  // ⌘+clic en el visor sobre una foto en revisión (amarilla): el fotógrafo la
  // VALIDA — deja de estar en revisión, pasa a estado verde (SELECT) y queda
  // marcada. Cuenta como un paso de deshacer.
  const validatePhoto = (id) => {
    record();
    // Validar (⌘+clic) saca la foto de revisión: deja de ser amarilla y pasa a verde.
    // Si tenía las 3 estrellas de la revisión, sube a 5 (validada).
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, aiReview: false, rating: it.rating === 3 ? 5 : it.rating, status: it.status === "REVIEW" ? "SELECT" : it.status } : it)));
    setSelectedIds((prev) => { const next = new Set(prev); next.add(id); return next; });
  };

  // Atajos de teclado del visor: 5 = verde (seleccionada), 3 = amarillo (revisión).
  // SET (no toggle): la foto pasa al estado indicado sea cual sea su estado previo.
  // Cuenta como un paso de deshacer.
  const markAsSelected = (id) => {
    record();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, aiReview: false, rating: 5, status: it.status === "TOP_PICK" ? "TOP_PICK" : "SELECT" } : it)));
    setSelectedIds((prev) => { const next = new Set(prev); next.add(id); return next; });
  };
  const markAsReview = (id) => {
    record();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, aiReview: true, rating: 3, status: "REVIEW" } : it)));
    setSelectedIds((prev) => { const next = new Set(prev); next.add(id); return next; });
  };

  const toggleSelect = (id) => {
    record();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Marca/desmarca varias fotos a la vez (rango con Mayús) como UN solo paso.
  const toggleSelectMany = (ids, mark) => {
    if (!ids.length) return;
    record();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (mark ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const toggleSelectAll = () => {
    record();
    setSelectedIds((prev) => (prev.size === items.length ? new Set() : new Set(items.map((it) => it.id))));
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    record();
    setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
    setSelectedIds(new Set());
  };

  const save = async () => {
    if (!title.trim()) {
      toast({ title: "Falta el nombre del proyecto", variant: "destructive" });
      return;
    }
    if (!items.length || (!existing && !folderHandle)) {
      toast({ title: "Selecciona la carpeta RAW primero", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Handles: al reabrir un proyecto, solo se guardan refs NUEVOS si el usuario
      // volvió a elegir carpeta/catálogo en esta sesión; si no, se conservan los ya
      // vinculados al proyecto (restoredHandles evita duplicarlos).
      const rehookFolder = folderHandle && folderHandle !== restoredHandles.folder;
      const rehookCatalog = catalogHandle && catalogHandle !== restoredHandles.catalog;
      const folderRef = existing
        ? (rehookFolder ? await saveHandle(folderHandle, "directory", { name: folderHandle.name }) : existing.folderRef)
        : await saveHandle(folderHandle, "directory", { name: folderHandle.name });
      const catalogRef = existing
        ? (rehookCatalog ? await saveHandle(catalogHandle, "file", { name: catalogHandle.name }) : existing.catalogRef)
        : (catalogHandle ? await saveHandle(catalogHandle, "file", { name: catalogHandle.name }) : null);

      // La SELECCIÓN que se guarda son las fotos MARCADAS (checkbox): al crear el
      // proyecto están todas marcadas por defecto, así que se guardan todas. Las
      // marcadas sin curar (REVIEW) suben a SELECT (etiqueta verde, sin forzar estrellas);
      // la curación manual del botón «A revisar» siempre prevalece si existe.
      // La marca (checkbox) es LA selección: las marcadas sin curar suben a SELECT;
      // las DESMARCADAS que estaban en SELECT vuelven a REVIEW (la curación manual
      // TOP_PICK/REJECT se conserva). Así, al reabrir el proyecto, solo aparecen
      // como seleccionadas las fotos que el fotógrafo dejó realmente marcadas.
      const effStatus = (it) => {
        // La IA envió esta foto a revisión (o el fotógrafo le dio 3 estrellas): se
        // mantiene en REVIEW (amarillo), nunca se promueve a SELECT aunque siga marcada.
        if (it.aiReview || it.rating === 3) return "REVIEW";
        if (selectedIds.has(it.id)) return it.status === "REVIEW" ? "SELECT" : it.status;
        return it.status === "TOP_PICK" || it.status === "REJECT" ? it.status : "REVIEW";
      };
      const selCount = items.filter(
        (it) => selectedIds.has(it.id) && ["TOP_PICK", "SELECT"].includes(effStatus(it))
      ).length;
      const payload = {
        title: title.trim(),
        event_date: eventDate || undefined,
        status: selCount > 0 ? "editing" : "draft",
        selection_saved: selCount > 0,
        photo_count: items.length,
        selected_count: selCount,
        lightroom_catalog_name: catalogHandle?.name || existing?.catalogName || "",
        raw_folder_path: folderHandle?.name || existing?.folderName || "",
      };
      // La traza de la última selección IA viaja DENTRO del guardado del proyecto:
      // create/update la persisten en la misma operación atómica que el resto.
      if (lastTraceRef.current) payload.ai_config_snapshot = { selection_trace: lastTraceRef.current };

      // Proyecto existente: se ACTUALIZA (nunca se crea un duplicado). El estado actual
      // del espacio de trabajo reemplaza a los fingerprints guardados, incluyendo las
      // fotos eliminadas y los cambios de estado hechos al reabrir.
      const savedId = existing ? existing.projectId : (await createProject(payload)).id;

      if (existing) {
        await updateProject(existing.projectId, payload);
        if (existing.bindingId) {
          await updateCatalogBinding(existing.bindingId, {
            catalog_handle_ref: catalogRef || "",
            raw_folder_handle_ref: folderRef || "",
            catalog_filename: catalogHandle?.name || existing.catalogName || "",
            raw_folder_name: folderHandle?.name || existing.folderName || "",
          });
        } else {
          // El proyecto se creó al inicio (al importar la carpeta) sin binding; se crea aquí.
          const binding = await createCatalogBinding({
            project_id: savedId,
            catalog_handle_ref: catalogRef || "",
            raw_folder_handle_ref: folderRef || "",
            catalog_filename: catalogHandle?.name || "",
            raw_folder_name: folderHandle?.name || existing.folderName || "",
          });
          setExisting((prev) => ({ ...prev, bindingId: binding?.id || null }));
        }
        await deleteFingerprintsByProject(existing.projectId);
      } else {
        const binding = await createCatalogBinding({
          project_id: savedId,
          catalog_handle_ref: catalogRef || "",
          raw_folder_handle_ref: folderRef,
          catalog_filename: catalogHandle?.name || "",
          raw_folder_name: folderHandle.name,
        });
        // TRAS CREAR el proyecto, fijar `existing` para que el SIGUIENTE guardado
        // ACTUALICE este proyecto en vez de crear un duplicado. Sin esto, cada
        // guardado tras la creación genera un proyecto nuevo (bug de duplicación).
        // También actualiza la URL con ?project=<id> para que un refresh no pierda
        // el contexto y siga abriendo el mismo proyecto.
        setExisting({
          projectId: savedId,
          bindingId: binding?.id || null,
          folderRef: folderRef || "",
          catalogRef: catalogRef || "",
          folderName: folderHandle?.name || "",
          catalogName: catalogHandle?.name || "",
        });
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("project", savedId);
          window.history.replaceState({}, "", url.toString());
        } catch {}
      }

      await bulkCreateFingerprints(
        items.map((it) => ({
          project_id: savedId,
          fingerprint_hash: it.fingerprint.fingerprint_hash,
          filename: it.fingerprint.filename,
          relative_path: it.fingerprint.relative_path,
          capture_time: it.fingerprint.capture_time,
          camera_make: it.fingerprint.camera_make,
          camera_model: it.fingerprint.camera_model,
          file_size: it.fingerprint.file_size,
          selection_status: effStatus(it),
          // La marca (checkbox) de cada foto se persiste: al reabrir el proyecto
          // aparecen marcadas/desmarcadas exactamente como se dejaron al guardar.
          marked: selectedIds.has(it.id),
          ...statusMeta(effStatus(it), it.rating || 0),
          // Revisión (la IA la envió a revisar o tiene 3 estrellas) → XMP con 3 ESTRELLAS +
          // etiqueta AMARILLA (xmp:Rating=3 + xmp:Label="Yellow"), detectable por Lightroom.
          ...(it.aiReview || it.rating === 3 ? { rating: 3, color_label: "yellow" } : {}),
        }))
      );

      // Pasa las previews ya extraídas al detalle para no volver a procesarlas al abrir.
      setPendingProjectPreviews(
        savedId,
        items.map((it) => ({
          filename: it.file.name,
          preview: it.preview,
          cameraInfo: it.cameraInfo,
          asShotWB: it.asShotWB,
          skinStats: it.skinStats,
          fingerprint: it.fingerprint,
          status: effStatus(it),
        }))
      );
      toast({
        title: "Proyecto guardado",
        description: `${items.length} fotos guardadas · ${selectedIds.size} seleccionadas`,
      });
      return savedId;
    } catch (e) {
      toast({ title: "No se pudo guardar", description: e?.message, variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setBusyAction("save");
    try { await save(); } finally { setBusyAction(null); }
  };
  // SELECCIÓN IA EN LA MISMA PÁGINA: analiza únicamente las fotos MARCADAS (checkbox).
  // Las elegidas por la IA quedan con las 5 estrellas ACTIVAS; las que la IA envía a
  // revisión pasan su cuadrado/borde a AMARILLO. No navega a otra pantalla: el proceso
  // completo ocurre aquí. Guardar persiste el resultado (5★ + verde viaja al XMP).
  const runAiSelection = async () => {
    const marked = items.filter((it) => selectedIds.has(it.id));
    if (!marked.length) {
      toast({ title: "Marca al menos una foto para la selección IA", variant: "destructive" });
      return;
    }
    record();
    setBusyAction("seleccion");
    setAiRunning(true);
    setAiDone(0);
    setAiTotal(marked.length);
    const selectionProjectId = existing?.projectId || projectIdParam || null;
    let selJobId = null;
    const syncSelJob = async (status, stage, stats = null, error = null) => {
      if (!selectionProjectId) return;
      try {
        if (!selJobId) {
          const j = await base44.entities.AlbumAISelection.create({
            project_id: selectionProjectId,
            status,
            stage,
            stats: stats || { photo_count: marked.length },
          });
          selJobId = j.id;
          currentSelJobIdRef.current = j.id;
        } else {
          const patch = { status, stage };
          if (stats) patch.stats = stats;
          if (error) patch.error = String(error).slice(0, 500);
          await base44.entities.AlbumAISelection.update(selJobId, patch);
        }
      } catch {}
    };
    // Fiabilidad: cancela jobs "running" anteriores de este proyecto antes de empezar
    // uno nuevo. Evita jobs duplicados colgados que confunden al sondeo al volver.
    if (selectionProjectId) {
      try {
        await base44.entities.AlbumAISelection.updateMany(
          { project_id: selectionProjectId, status: "running" },
          { $set: { status: "canceled", error: "Reemplazado por una nueva selección" } }
        );
      } catch {}
    }
    await syncSelJob("running", "e2");
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
          // phash restaurado del fingerprint guardado (proyectos reabiertos): sin él la
          // agrupación de ráfagas degrada a solo-temporal.
          phash: it.phash || (it.fingerprint?.fingerprint_hash ? BigInt("0x" + it.fingerprint.fingerprint_hash) : null),
          captureTime: it.captureTime ?? it.fingerprint?.capture_time ?? null,
          cameraInfo: it.cameraInfo || { make: it.fingerprint?.camera_make, model: it.fingerprint?.camera_model },
          technical: it.technical || { sharpness: 0, exposureScore: 0.5, corrupt: false },
        };
      });
      const { keep, meta, trace } = await selectBursts(aiItems, (d, t) => {
        if (!mountedRef.current) return;
        setAiDone(d);
        if (typeof t === "number") setAiTotal(t);
      });
      // Si el componente se desmontó durante la selección (el usuario navegó fuera),
      // el job ya se canceló en el cleanup. No actualizamos estado ni mostramos toast:
      // evitar "error 5" y warnings de React.
      if (!mountedRef.current) return;
      // Persiste la traza completa de la ejecución en el proyecto para auditarla.
      // Se guarda en el ref: «Guardar» la re-escribe junto con el proyecto. La
      // escritura inmediata sigue siendo fire-and-forget, pero si falla se avisa
      // (antes el error se tragaba en silencio y la traza se perdía sin rastro).
      lastTraceRef.current = trace || null;
      const traceProjectId = existing?.projectId || projectIdParam;
      if (trace && traceProjectId) {
        base44.entities.Project.update(traceProjectId, { ai_config_snapshot: { selection_trace: trace } })
          .catch((e) => toast({
            title: "Traza de selección no guardada",
            description: `Se guardará al pulsar «Guardar». Motivo: ${e?.message || "desconocido"}`,
            variant: "destructive",
          }));
      }
      setItems((prev) => prev.map((it) => {
        if (!selectedIds.has(it.id)) return it; // solo participan las marcadas
        const m = meta.get(it.id);
        if (!m) return it;
        const status = m.status || (keep.has(it.id) ? "SELECT" : "REVIEW");
        const aiSelected = status === "SELECT" || status === "TOP_PICK";
        const review = !aiSelected && status !== "REJECT";
        return {
          ...it,
          status,
          // Elegidas por la IA: 5★ · enviadas a revisar: 3★ (amarillo) · descartadas: 0★.
          rating: aiSelected ? 5 : review ? 3 : 0,
          aiReview: review,
        };
      }));
      await syncSelJob("completed", "done", { photo_count: marked.length, provider_used: trace?.provider || null });
      toast({ title: "Selección IA completada" });
    } catch (e) {
      if (mountedRef.current) {
        await syncSelJob("failed", "e2", null, e?.message || "Error desconocido");
        toast({ title: "No se pudo ejecutar la selección IA", description: e?.message, variant: "destructive" });
      }
    }
    currentSelJobIdRef.current = null;
    if (mountedRef.current) {
      setAiRunning(false);
      setBusyAction(null);
    }
  };

  // Cancela el job de selección IA en curso (botón Cancelar). Marca el job como
  // "canceled" en la base de datos y desbloquea la UI. El proceso asíncrono que corre
  // en la página se abandona (su resultado se ignora porque mountedRef/job ya no activos).
  const cancelSelection = async () => {
    const jobId = currentSelJobIdRef.current;
    if (jobId) {
      try {
        await base44.entities.AlbumAISelection.update(jobId, {
          status: "canceled",
          error: "Cancelado por el usuario",
        });
      } catch {}
      currentSelJobIdRef.current = null;
    }
    setAiRunning(false);
    setBusyAction(null);
    setAiDone(0);
    toast({ title: "Selección IA cancelada" });
  };
  const goEditar = async () => {
    setBusyAction("editar");
    const id = await save().finally(() => setBusyAction(null));
    if (!id) return;
    // El proyecto ya está creado: «Editar» lleva las fotos SELECCIONADAS a la sesión
    // del módulo de revelado (mismo contrato que DetalleProyectoPage → AjustesIA),
    // así que NO vuelve a pedir la carpeta RAW — el módulo arranca con las fotos
    // del proyecto ya cargadas.
    const effStatus = (it) => {
      if (it.aiReview || it.rating === 3) return "REVIEW";
      if (selectedIds.has(it.id)) return it.status === "REVIEW" ? "SELECT" : it.status;
      return it.status === "TOP_PICK" || it.status === "REJECT" ? it.status : "REVIEW";
    };
    const selected = items
      .filter((it) => ["TOP_PICK", "SELECT"].includes(effStatus(it)))
      .map((it) => ({
        id: it.id,
        file: it.file,
        preview: it.preview,
        manualRotation: 0,
        rating: it.rating || 0,
        colorLabel: it.aiReview ? "yellow" : "green",
        cameraInfo: it.cameraInfo || null,
        asShotWB: it.asShotWB || null,
        skinStats: it.skinStats || null,
      }));
    if (!selected.length) {
      toast({ title: "Sin fotos seleccionadas", description: "Marca al menos una foto para llevarla a Editar.", variant: "destructive" });
      return;
    }
    setSession({ photos: selected });
    navigate("/ajustes-ia");
  };
  const goAlbum = async () => {
    setBusyAction("album");
    const id = await save().finally(() => setBusyAction(null));
    if (id) navigate("/album");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{existing ? "Editar proyecto" : "Nuevo proyecto"}</h1>
        <button
          onClick={() => navigate("/proyectos")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Mis proyectos
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Nombre del proyecto</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Boda García-López"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Fecha del evento</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={pickCatalog} className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary">
            <FileText className="h-4 w-4" /> {catalogHandle ? catalogHandle.name : existing?.catalogName || "Seleccionar catálogo .lrcat"}
          </button>
          <button onClick={pickFolder} className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary">
            <FolderOpen className="h-4 w-4" /> {folderHandle ? folderHandle.name : existing?.folderName || "Seleccionar carpeta RAW"}
          </button>
        </div>
      </div>

      {extracting && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />{" "}
              {phase === "extracting" ? "Leyendo previews embebidas…" : "Calculando huellas digitales…"}
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-accent transition-all duration-150"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {phase === "extracting"
              ? `${progress.done} / ${progress.total / 2 || 0} fotos procesadas`
              : `${Math.max(0, progress.done - progress.total / 2)} / ${progress.total / 2 || 0} huellas calculadas`}
          </p>
        </div>
      )}

      {aiRunning && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando ráfagas con IA…
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold tabular-nums">
                {aiDone} / {aiTotal}
              </span>
              <button
                onClick={cancelSelection}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5"
              >
                <X className="h-3.5 w-3.5" /> Cancelar
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            La selección se ejecuta en esta página, solo sobre las fotos marcadas. Si sales y vuelves, puedes cancelar y volver a lanzarla.
          </p>
        </div>
      )}

      {!extracting && items.length > 0 && (
        <ProjectPhotoWorkspace
          items={items.map((it) => ({
            id: it.id,
            filename: it.file.name,
            status: it.status,
            rating: it.rating || 0,
            aiReview: !!it.aiReview,
            previewUrl: it.preview?.dataUrl,
            hiResUrl: it.preview?.hiResDataUrl,
            // Datos para ordenar: hora de captura (epoch ms) y cámara (marca + modelo).
            captureTime: it.fingerprint?.capture_time,
            camera: [it.fingerprint?.camera_make, it.fingerprint?.camera_model].filter(Boolean).join(" "),
          }))}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectMany={toggleSelectMany}
          onToggleSelectAll={toggleSelectAll}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onDeleteSelected={deleteSelected}
          onCycleStatus={cycleStatus}
          onValidatePhoto={validatePhoto}
          onMarkSelected={markAsSelected}
          onMarkReview={markAsReview}
          gridCols={gridCols}
          onGridCols={setGridCols}
          saving={saving}
          busyAction={busyAction}
          onSave={handleSave}
          onGoSeleccion={runAiSelection}
          aiRunning={aiRunning}
          onGoEditar={goEditar}
          onGoAlbum={goAlbum}
        />
      )}
    </div>
  );
}