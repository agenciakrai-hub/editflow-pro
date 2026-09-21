import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, FileText, Loader2, ArrowLeft, X, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
// Solo IMPORTA (no modifica) utilidades del motor de Selección existente.
import { selectBursts } from "@/lib/ai/aiGateway";
import { statusMeta, SELECTION_CYCLE } from "./lib/projectFingerprint";
import { saveHandle } from "./lib/idbHandles";
import { createProject, createCatalogBinding, bulkCreateFingerprints, getProject, listFingerprintsByFolder, deleteFingerprintsByFolder, ensureFoldersMigrated, updateFolder, updateProject } from "./hooks/useProjectStore";
import { startProcessing, getJob, subscribe } from "./lib/backgroundProcessor";
import { startAiSelection, getJob as getAiJob, subscribe as subscribeAi, cancelSelection as cancelAiSelection } from "./lib/backgroundAiSelection";
import ProjectPhotoWorkspace from "./components/ProjectPhotoWorkspace";
import { useToast } from "@/components/ui/use-toast";
import useUndoRedo from "@/hooks/useUndoRedo";
import { setPendingProjectPreviews, setSession } from "@/lib/rawaistudio/localSession";

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
  const urlParams = new URLSearchParams(window.location.search);
  const projectIdParam = urlParams.get("project");
  const folderIdParam = urlParams.get("folder");
  const modeParam = urlParams.get("mode"); // "seleccion" | "edicion" | null
  const [existing, setExisting] = useState(null);
  // Móvil: fallback cuando showOpenFilePicker no existe.
  const [catalogFile, setCatalogFile] = useState(null);
  const catalogInputRef = useRef(null);

  // Fiabilidad: al desmontar la página (navegar fuera, ir atrás, cambiar de herramienta),
  // se marca el job de selección IA en curso como "canceled" para que no quede colgado
  // en "running" para siempre. Al volver, la página no se bloquea mostrando un spinner
  // muerto. También se marca el componente como desmontado para evitar updates de estado.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // NO se cancela el job de selección IA al abandonar la página: el proceso
      // corre en segundo plano (backgroundAiSelection) y continúa independientemente
      // del componente. Al volver, el componente se suscribe y muestra el progreso.
    };
  }, []);

  useEffect(() => {
    if (!projectIdParam) return;
    // Carpeta/sesión activa: si no se especificó folderId, redirige a la página de
    // carpetas del proyecto. Migra proyectos existentes sin carpetas (idempotente).
    let alive = true;
    let unsub = null;
    (async () => {
      try {
        const folders = await ensureFoldersMigrated(projectIdParam);
        if (!alive) return;
        if (!folderIdParam) { navigate(`/proyectos/${projectIdParam}`, { replace: true }); return; }
        const folder = folders.find((f) => f.id === folderIdParam);
        if (!folder) { navigate(`/proyectos/${projectIdParam}`, { replace: true }); return; }
        // Si hay un job activo de ESTA carpeta, se suscribe a él.
        const activeJob = getJob(projectIdParam, folder.id);
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
          unsub = subscribe(projectIdParam, folder.id, (job) => {
            if (!alive) return;
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
          return;
        }
        const [p, fps] = await Promise.all([getProject(projectIdParam), listFingerprintsByFolder(folder.id)]);
        if (!alive) return;
        setTitle(p?.title || "");
        setEventDate(p?.event_date || "");
        setExisting({
          projectId: projectIdParam,
          folderId: folder.id,
          folderName: folder.raw_folder_name || folder.name || "",
        });
        // NO se cargan todas las previews al abrir: con 4000+ fotos, cargar todas
        // las previews agotaría la memoria del navegador. Las previews se cargan
        // bajo demanda (LazyPhotoCard en la galería, PreviewLightbox en el visor)
        // desde IndexedDB usando el fingerprint_hash de cada foto.
        const loaded = fps.map((f) => ({
          id: f.id,
          file: { name: f.filename },
          status: f.selection_status || "REVIEW",
          rating: f.rating || 0,
          aiReview: f.color_label === "yellow",
          fingerprint: f,
          preview: null,
        }));
        if (!alive) return;
        setItems(loaded);
        setSelectedIds(new Set(loaded.filter((it) => it.fingerprint.marked !== false).map((it) => it.id)));
      } catch (e) {
        toast({ title: "No se pudo abrir el proyecto", description: e?.message, variant: "destructive" });
      }
    })();
    return () => { alive = false; if (unsub) unsub(); };
  }, [projectIdParam, folderIdParam]);

  // Detecta una selección IA en curso al reabrir el proyecto (el usuario pudo
  // navegar fuera y volver). Sondea el job de AlbumAISelection hasta que termina
  // y entonces oculta la barra y avisa al usuario.
  useEffect(() => {
    if (!projectIdParam || !folderIdParam) return;
    // Si hay un job de selección IA en segundo plano (en memoria), la suscripción lo
    // maneja — no se necesita sondeo de la base de datos. El sondeo solo es para jobs
    // que se quedaron "running" en la BD sin proceso en memoria (pestaña cerrada).
    if (getAiJob(projectIdParam, folderIdParam)) return;
    let alive = true;
    let pollTimer = null;

    const checkAndPoll = async () => {
      try {
        const jobs = await base44.entities.AlbumAISelection.filter(
          { project_id: projectIdParam, folder_id: folderIdParam, status: "running" },
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
  }, [projectIdParam, folderIdParam]);

  // Suscripción al job de selección IA en segundo plano: si el usuario sale y vuelve
  // mientras la selección está corriendo, este effect reconecta con el job activo y
  // muestra el progreso en vivo. Si el job ya terminó, aplica los resultados al estado.
  useEffect(() => {
    if (!projectIdParam || !folderIdParam) return;
    const bgJob = getAiJob(projectIdParam, folderIdParam);
    if (!bgJob) return;
    setAiRunning(bgJob.status === "running");
    setBusyAction(bgJob.status === "running" ? "seleccion" : null);
    setAiDone(bgJob.done);
    setAiTotal(bgJob.total);
    if (bgJob.status === "completed" && bgJob.results?.size) {
      applyAiResults(bgJob);
    }
    const unsub = subscribeAi(projectIdParam, folderIdParam, (job) => {
      if (!mountedRef.current) return;
      setAiDone(job.done);
      if (typeof job.total === "number") setAiTotal(job.total);
      if (job.status === "completed") {
        applyAiResults(job);
        setAiRunning(false);
        setBusyAction(null);
        toast({ title: "Selección IA completada" });
      } else if (job.status === "failed") {
        setAiRunning(false);
        setBusyAction(null);
        toast({ title: "Selección IA no completada", description: job.error || "Error", variant: "destructive" });
      } else if (job.status === "canceled") {
        setAiRunning(false);
        setBusyAction(null);
      }
    });
    return unsub;
  }, [projectIdParam, folderIdParam]);

  const pickCatalog = async () => {
    // Desktop: File System Access API.
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "Catálogo Lightroom", accept: { "application/octet-stream": [".lrcat"] } }],
        });
        setCatalogHandle(handle);
        setCatalogFile(null);
      } catch {
        // Usuario canceló el selector — no es un error.
      }
      return;
    }
    // Móvil: <input type="file" accept=".lrcat">
    catalogInputRef.current?.click();
  };

  const onCatalogPicked = (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    setCatalogFile(file);
    setCatalogHandle(null);
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

  // Ciclo de 3 estados con clic izquierdo sobre la foto: sin color (0★) → verde (5★)
  // → amarillo (3★) → sin color (0★). Reemplaza al toggle de selección del clic simple.
  const cycleClickState = (id) => {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const isGreen = item.rating === 5;
    const isYellow = !!item.aiReview || item.rating === 3;
    record();
    if (!isGreen && !isYellow) {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, aiReview: false, rating: 5, status: it.status === "TOP_PICK" ? "TOP_PICK" : "SELECT" } : it));
      setSelectedIds((prev) => { const next = new Set(prev); next.add(id); return next; });
    } else if (isGreen) {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, aiReview: true, rating: 3, status: "REVIEW" } : it));
      setSelectedIds((prev) => { const next = new Set(prev); next.add(id); return next; });
    } else {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, aiReview: false, rating: 0, status: "REVIEW" } : it));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
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
    if (!items.length || !existing) {
      toast({ title: "Selecciona la carpeta RAW primero", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
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
        await deleteFingerprintsByFolder(existing.folderId);
      } else {
        // TRAS CREAR el proyecto, fijar `existing` para que el SIGUIENTE guardado
        // ACTUALICE este proyecto en vez de crear un duplicado.
        setExisting({
          projectId: savedId,
          folderId: existing?.folderId || folderIdParam || null,
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
          folder_id: existing?.folderId || folderIdParam || "",
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

      // Actualiza el estado de la carpeta: selección completada si hay fotos seleccionadas.
      if (existing?.folderId) {
        await updateFolder(existing.folderId, {
          selection_status: selCount > 0 ? "completed" : "pending",
          photo_count: items.length,
          last_modified: new Date().toISOString(),
        }).catch(() => {});
      }

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
  const applyAiResults = (job) => {
    if (!job.results) return;
    setItems((prev) => prev.map((it) => {
      const r = job.results.get(it.id);
      if (!r) return it;
      return { ...it, status: r.status, rating: r.rating, aiReview: r.aiReview };
    }));
  };

  const runAiSelection = async () => {
    const marked = items.filter((it) => selectedIds.has(it.id));
    if (!marked.length) {
      toast({ title: "Marca al menos una foto para la selección IA", variant: "destructive" });
      return;
    }
    const selectionProjectId = existing?.projectId || projectIdParam || null;
    const selectionFolderId = existing?.folderId || folderIdParam || null;
    if (!selectionProjectId || !selectionFolderId) {
      toast({ title: "Guarda el proyecto primero", variant: "destructive" });
      return;
    }
    record();
    setBusyAction("seleccion");
    setAiRunning(true);
    setAiDone(0);
    setAiTotal(marked.length);
    // La selección corre en SEGUNDO PLANO (backgroundAiSelection): sobrevive a la
    // navegación y carga las previews por lotes desde IndexedDB (no todas a la vez,
    // para no agotar la memoria con carpetas de 4000-20000 fotos).
    startAiSelection({
      projectId: selectionProjectId,
      folderId: selectionFolderId,
      items,
      selectedIds,
      onProgress: (job) => {
        if (!mountedRef.current) return;
        setAiDone(job.done);
        if (typeof job.total === "number") setAiTotal(job.total);
      },
      onComplete: (job) => {
        if (!mountedRef.current) return;
        applyAiResults(job);
        setAiRunning(false);
        setBusyAction(null);
        toast({ title: "Selección IA completada" });
      },
      onError: (e) => {
        if (!mountedRef.current) return;
        setAiRunning(false);
        setBusyAction(null);
        toast({ title: "No se pudo ejecutar la selección IA", description: e?.message, variant: "destructive" });
      },
    });
  };

  // Cancela el job de selección IA en curso (botón Cancelar). Marca el job como
  // "canceled" en la base de datos y desbloquea la UI. El proceso asíncrono que corre
  // en la página se abandona (su resultado se ignora porque mountedRef/job ya no activos).
  const cancelSelection = async () => {
    const selectionProjectId = existing?.projectId || projectIdParam;
    const selectionFolderId = existing?.folderId || folderIdParam;
    if (selectionProjectId && selectionFolderId) {
      cancelAiSelection(selectionProjectId, selectionFolderId);
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
    const selectedBase = items.filter((it) => ["TOP_PICK", "SELECT"].includes(effStatus(it)));
    if (!selectedBase.length) {
      toast({ title: "Sin fotos seleccionadas", description: "Marca al menos una foto para llevarla a Editar.", variant: "destructive" });
      return;
    }
    // NO se cargan las previews aquí: con 4000+ fotos seleccionadas, cargar todas
    // las previews agotaría la memoria. Se pasa el fingerprintHash de cada foto y
    // AjustesIA carga cada preview bajo demanda al procesar esa foto concreta.
    const selected = selectedBase.map((it) => ({
      id: it.id,
      file: it.file,
      preview: null,
      fingerprintHash: it.fingerprint?.fingerprint_hash,
      manualRotation: 0,
      rating: it.rating || 0,
      colorLabel: it.aiReview ? "yellow" : "green",
      cameraInfo: it.cameraInfo || null,
      asShotWB: it.asShotWB || null,
      skinStats: it.skinStats || null,
    }));
    setSession({ photos: selected });
    navigate("/ajustes-ia");
  };
  const goAlbum = async () => {
    setBusyAction("album");
    const id = await save().finally(() => setBusyAction(null));
    if (id) navigate("/album");
  };

  // Crear proyecto nuevo: nombre + fecha + catálogo. NO requiere carpeta de fotos.
  // Crea el Project + CatalogBinding (catálogo a nivel de proyecto) y redirige a
  // la página de carpetas del proyecto, donde el usuario añade carpetas de fotos.
  const handleCreateProject = async () => {
    if (!title.trim()) {
      toast({ title: "Falta el nombre del proyecto", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const catalogRef = catalogHandle ? await saveHandle(catalogHandle, "file", { name: catalogHandle.name }) : null;
      const p = await createProject({
        title: title.trim(),
        event_date: eventDate || undefined,
        status: "draft",
        photo_count: 0,
        lightroom_catalog_name: catalogHandle?.name || catalogFile?.name || "",
      });
      await createCatalogBinding({
        project_id: p.id,
        catalog_handle_ref: catalogRef || "",
        catalog_filename: catalogHandle?.name || catalogFile?.name || "",
        raw_folder_name: "",
      });
      navigate(`/proyectos/${p.id}`);
    } catch (e) {
      toast({ title: "No se pudo crear el proyecto", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Auto-acción desde ProjectFoldersPage: mode=seleccion lanza la selección IA al
  // cargar la carpeta; mode=edicion lleva las fotos seleccionadas a AjustesIA.
  // Solo se dispara una vez (ref) y solo cuando hay fotos cargadas.
  const autoActionFiredRef = useRef(false);
  useEffect(() => {
    if (autoActionFiredRef.current) return;
    if (!items.length || !modeParam) return;
    if (!existing?.projectId && !projectIdParam) return;
    autoActionFiredRef.current = true;
    if (modeParam === "seleccion") runAiSelection();
    else if (modeParam === "edicion") goEditar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, modeParam, existing?.projectId]);

  // Modo «nuevo proyecto» (sin projectId): formulario simple con nombre + fecha +
  // catálogo. NO pide carpeta de fotos — las carpetas se añaden después, desde
  // la página de carpetas del proyecto.
  if (!projectIdParam) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Nuevo proyecto</h1>
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
              placeholder="Boda Curro y Celia"
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
          <div>
            <label className="text-xs font-medium text-muted-foreground">Catálogo de Lightroom (.lrcat)</label>
            <button onClick={pickCatalog} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary">
              <FileText className="h-4 w-4" /> {catalogHandle ? catalogHandle.name : catalogFile?.name || "Seleccionar catálogo .lrcat"}
            </button>
          </div>
          <input ref={catalogInputRef} type="file" accept=".lrcat" className="hidden" onChange={onCatalogPicked} />
        </div>
        <button
          onClick={handleCreateProject}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crear proyecto
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{existing ? title : "Nuevo proyecto"}</h1>
          {existing && <p className="text-sm text-muted-foreground">{existing.folderName}</p>}
        </div>
        <button
          onClick={() => navigate(existing ? `/proyectos/${existing.projectId}` : "/proyectos")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {existing ? "Proyecto" : "Mis proyectos"}
        </button>
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
            La selección corre en segundo plano sobre las fotos marcadas. Puedes salir de esta página y volver cuando quieras: el proceso continúa y los resultados se guardan automáticamente.
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
            fingerprintHash: it.fingerprint?.fingerprint_hash,
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
          onCycleClickState={cycleClickState}
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

      {!extracting && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Esta carpeta no tiene fotos. Vuelve a «Carpetas» y pulsa «Reintentar» si el procesado falló.
          </p>
        </div>
      )}
    </div>
  );
}