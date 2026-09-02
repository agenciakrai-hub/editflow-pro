import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FolderOpen, Loader2, ArrowRight, Sparkles, RotateCcw, Download, Save, CheckSquare, Square, Trash2 } from "lucide-react";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews, buildPhotoFromSelection } from "@/lib/rawaistudio/smartSelectionEngine";
import { selectBursts } from "@/lib/ai/aiGateway";
import { addRatingAndLabel } from "@/lib/rawaistudio/xmpTagPatcher";
import { base44 } from "@/api/base44Client";
import { setSession } from "@/lib/rawaistudio/localSession";
import { getProject, getCatalogBinding, listFingerprints, updateProject, updateCatalogBinding, bulkUpdateFingerprints } from "@/modules/proyectos/hooks/useProjectStore";
import { useFileSync } from "@/modules/proyectos/hooks/useFileSync";
import { computeFingerprint, matchFingerprints } from "@/modules/proyectos/lib/projectFingerprint";
import SelectionSummary from "@/modules/proyectos/components/SelectionSummary";
import LocationNotFoundModal from "@/modules/proyectos/components/LocationNotFoundModal";
import { COLOR_LABELS, lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { useToast } from "@/components/ui/use-toast";
import { getCachedPreviews, cachePreviews } from "@/modules/proyectos/lib/previewCache";
import PhotoCard from "@/components/rawaistudio/PhotoCard";
import ReviewFilters from "@/components/rawaistudio/ReviewFilters";
import Lightbox from "@/components/Lightbox";

// Pantalla de SELECCIÓN (local, mismo diseño que RAW AI Studio). Importa una carpeta de
// RAW, agrupa ráfagas, la IA marca en verde las mejores tomas, el fotógrafo revisa y
// confirma la cola de edición. Los RAW nunca se suben: solo su preview embebida (JPEG
// decodificado en el navegador) se envía a la IA de selección.
// Plantilla XMP mínima para los sidecars de selección: solo rating + label, sin
// ajustes de revelado. Cada foto recibe su sidecar con su estado real.
const SELECTION_XMP_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"/>
  </rdf:RDF>
</x:xmpmeta>`;

export default function Seleccion() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [files, setFiles] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [stage, setStage] = useState("idle"); // idle | previews | selecting | review
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [selectionFallback, setSelectionFallback] = useState(null);
  const [selectionCoverage, setSelectionCoverage] = useState(null);

  // ---- Modo proyecto (aditivo, no toca el flujo normal) ----
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const [project, setProject] = useState(null);
  const [binding, setBinding] = useState(null);
  const [fingerprints, setFingerprints] = useState([]);
  const [sync, setSync] = useState(null);
  const [showProjectSummary, setShowProjectSummary] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverPct, setRecoverPct] = useState(0);
  const [remoteJob, setRemoteJob] = useState(null);
  // Evita el auto-guardado en la primera población de fotos (carga inicial desde caché
  // o recuperación): solo persiste cuando la selección cambia realmente a partir de ahí.
  const skipAutoSaveRef = useRef(true);
  const [projectRawItems, setProjectRawItems] = useState([]);
  const [idToFpId, setIdToFpId] = useState({});
  const { checkSync, resyncFolder, resyncCatalog } = useFileSync();

  const [quickFilter, setQuickFilter] = useState(projectId ? "all" : "select");
  const [colorFilter, setColorFilter] = useState(new Set(COLOR_LABELS.map((c) => c.key)));
  const [minStars, setMinStars] = useState(0);
  // Densidad del grid + selección múltiple para eliminar.
  const [gridCols, setGridCols] = useState(6);
  const [bulkIds, setBulkIds] = useState(new Set());
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const onPick = (list) => {
    const raws = Array.from(list || []).filter((f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name));
    if (!raws.length) return;
    setFiles(raws);
    runSelection(raws);
  };

  const runSelection = async (raws) => {
    setError(null);
    setStage("previews");
    setTotal(raws.length);
    setDone(0);
    const items = raws.map((file, i) => ({ id: String(i), file }));
    const withPreview = await extractPreviews(items, (d) => setDone(d));

    setStage("selecting");
    setTotal(withPreview.length);
    setDone(0);
    const { keep, meta, selection_fallback, fallback_reason, selection_coverage_fallback, coverage_promotions } = await selectBursts(withPreview, (d, t) => {
      setDone(d);
      if (typeof t === "number") setTotal(t);
    });
    const built = withPreview.map((p) => buildPhotoFromSelection(p, keep, meta));
    setPhotos(built);
    setSelectionFallback(selection_fallback ? { active: true, reason: fallback_reason } : null);
    setSelectionCoverage(selection_coverage_fallback ? { active: true, promotions: coverage_promotions || [] } : null);
    setStage("review");
  };

  // Recuperación local en segundo plano: re-extrae previews de la carpeta RAW, verifica
  // identidad por fingerprint y rellena la caché. Extraída a función para poder invocarla
  // tanto al abrir el proyecto como al detectar que otro dispositivo terminó su procesado.
  const startOwnRecovery = (b, fps) => {
    if (!b) return;
    setRecovering(true);
    (async () => {
      try {
        const s = await checkSync(b.catalog_handle_ref, b.raw_folder_handle_ref);
        setSync(s);
        if (s.folderOk && s.folderHandle) await recoverFromFolder(s.folderHandle, fps);
      } catch (e) {
        setError(e?.message || "No se pudo recuperar la carpeta");
      } finally {
        setRecovering(false);
      }
    })();
  };

  // ---- Modo proyecto: abre un proyecto existente, comprueba RAW + catálogo, recupera
  // fotos y selección guardada, y las carga en este mismo flujo de revisión. No crea un
  // segundo motor: reutiliza extractPreviews + el grid de revisión existente. ----
  const loadProject = async () => {
    setProjectLoading(true);
    try {
      const p = await getProject(projectId);
      const b = await getCatalogBinding(projectId);
      const fps = await listFingerprints(projectId);
      setProject(p);
      setBinding(b);
      setFingerprints(fps);
      setShowProjectSummary(false);
      // Muestra el proyecto al instante: deja de cargar aquí y recupera las fotos en segundo plano.
      setProjectLoading(false);

      // Instant: construye las fotos desde las previews cacheadas (IndexedDB) + la selección
      // guardada, para que las imágenes aparezcan sin re-extraerlas de la carpeta RAW.
      let instantShown = false;
      try {
        const cached = await getCachedPreviews(fps.map((f) => f.fingerprint_hash).filter(Boolean));
        if (cached.size) {
          const built = fps.map((f) => {
            const dataUrl = cached.get(f.fingerprint_hash);
            // Estado NEUTRO al entrar: la selección se produce solo al pulsar "Seleccionar".
            // No se traen estados/etiquetas/ratings de una selección anterior.
            return {
              id: f.id, file: { name: f.filename },
              preview: dataUrl ? { dataUrl, base64: (dataUrl.split(",")[1] || dataUrl), isPlaceholder: false } : null,
              manualRotation: 0, aiSelected: false, selectedForEdit: false,
              colorLabel: "none",
              rating: 0, status: "REVIEW", groupId: null, groupSize: 1,
              complementary: false, reason: null, overallScore: 0, scores: null, rejectReasons: [],
              confidence: null, category: null, groupRank: null, captureTime: f.capture_time,
              // phash restaurado desde el fingerprint guardado (fingerprint_hash = pHash en
              // hex). Sin él, groupIntoScenes degrada a agrupación solo temporal y fusiona
              // escenas visualmente distintas en pocas ráfagas grandes (17 vs 130).
              phash: f.fingerprint_hash ? BigInt("0x" + f.fingerprint_hash) : null,
              cameraInfo: { make: f.camera_make, model: f.camera_model }, asShotWB: null, skinStats: null,
              technical: { sharpness: 0, exposureScore: 0.5, corrupt: false },
              analysisComplete: false, missingDimensions: [], previewWarning: !dataUrl,
              selectionFallback: false, fallbackReason: null, fingerprintId: f.id,
            };
          });
          setPhotos(built);
          setStage("review");
          instantShown = true;
        }
      } catch {
        // Sin caché todavía: las fotos llegarán tras la recuperación en segundo plano.
      }

      if (instantShown) {
        // Con caché: solo comprueba el estado de sincronización (🟢/🔴) sin re-procesar nada.
        if (b) {
          (async () => {
            try { setSync(await checkSync(b.catalog_handle_ref, b.raw_folder_handle_ref)); } catch {}
          })();
        }
      } else {
        // Sin caché local: comprueba si el mismo usuario ya está procesando este proyecto
        // en otro dispositivo (p. ej. el equipo de sobremesa). Si es así, sigue su progreso
        // en vivo en lugar de empezar una recuperación propia que duplicaría el trabajo.
        let remote = null;
        try {
          const jobs = await base44.entities.ProjectProcessingJob.filter({ project_id: projectId, status: "processing" }, "-updated_date", 1);
          remote = jobs?.[0];
        } catch {}
        if (remote && Date.now() - new Date(remote.updated_date).getTime() < 120000) {
          setRemoteJob(remote);
        } else {
          if (remote) { try { await base44.entities.ProjectProcessingJob.update(remote.id, { status: "failed" }); } catch {} }
          startOwnRecovery(b, fps);
        }
      }
    } catch (e) {
      setError(e?.message || "No se pudo cargar el proyecto");
      setProjectLoading(false);
    }
  };

  const recoverFromFolder = async (folderHandle, savedFingerprints) => {
    const raws = [];
    for await (const [name, entryHandle] of folderHandle.entries()) {
      if (entryHandle.kind !== "file") continue;
      if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
      raws.push(await entryHandle.getFile());
    }
    const count = raws.length;
    const total = count * 2;
    setRecoverPct(0);
    // Publica el progreso en la base de datos para que el mismo usuario pueda verlo
    // desde otro dispositivo (p. ej. el móvil) mientras este equipo procesa la carpeta.
    let jobId = null;
    let lastPct = -1;
    let lastPhase = null;
    const syncJob = async (progress, phase, status = "processing") => {
      try {
        if (!jobId) {
          const j = await base44.entities.ProjectProcessingJob.create({ project_id: projectId, status, progress, phase });
          jobId = j.id;
        } else if (status !== "processing" || Math.abs(progress - lastPct) >= 4 || phase !== lastPhase) {
          await base44.entities.ProjectProcessingJob.update(jobId, { status, progress, phase });
        }
        lastPct = progress; lastPhase = phase;
      } catch {}
    };
    await syncJob(0, "extracting");
    const items = raws.map((f, i) => ({ id: String(i), file: f }));
    let withPreview = [];
    let withFp = [];
    try {
      withPreview = await extractPreviews(items, (d) => {
        const pct = total ? Math.round((d / total) * 100) : 0;
        setRecoverPct(pct);
        syncJob(pct, "extracting");
      });
      for (let i = 0; i < withPreview.length; i++) {
        const p = withPreview[i];
        withFp.push({ ...p, fingerprint: await computeFingerprint({ file: p.file, preview: p.preview, relativePath: p.file.name }) });
        const pct = total ? Math.round(((count + i + 1) / total) * 100) : 0;
        setRecoverPct(pct);
        syncJob(pct, "fingerprinting");
      }
      setRecoverPct(100);
      await syncJob(100, "fingerprinting", "completed");
      // Rellena la caché de previews para que el próximo apertura del proyecto sea instantáneo.
      cachePreviews(withFp.map((p) => ({ hash: p.fingerprint?.fingerprint_hash, dataUrl: p.preview?.dataUrl }))).catch(() => {});
    } catch (e) {
      await syncJob(lastPct, lastPhase, "failed");
      throw e;
    }
    const candidates = withFp.map((p) => ({
      id: p.id, file: p.file, preview: p.preview, cameraInfo: p.cameraInfo,
      asShotWB: p.asShotWB, skinStats: p.skinStats, captureTime: p.captureTime,
      ...p.fingerprint,
    }));
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "lr-catalog-ids" });
      const catalogPhotos = res?.data?.photos || [];
      if (catalogPhotos.length) {
        const byName = new Map(catalogPhotos.map((cp) => [String(cp.fileName || "").toLowerCase(), cp.localId]));
        candidates.forEach((c) => {
          const lrId = byName.get(String(c.filename || "").toLowerCase());
          if (lrId) c.lr_local_id = lrId;
        });
      }
    } catch { /* sin plugin: la desambiguación cae a revisión manual */ }
    const results = matchFingerprints(savedFingerprints, candidates);
    setProjectRawItems(withPreview);
    const fpMap = {};
    results.forEach((r) => { if (r.matched && r.candidate) fpMap[r.candidate.id] = r.saved.id; });
    setIdToFpId(fpMap);
    const built = results
      .filter((r) => r.matched && r.candidate)
      .map((r) => {
        // Estado NEUTRO al recuperar de la carpeta: la selección se produce solo al
        // pulsar "Seleccionar". No se traen estados/etiquetas/ratings anteriores.
        return {
          id: r.candidate.id, file: r.candidate.file, preview: r.candidate.preview, manualRotation: 0,
          aiSelected: false, selectedForEdit: false,
          colorLabel: "none",
          rating: 0,
          status: "REVIEW", groupId: null, groupSize: 1, complementary: false, reason: null,
          overallScore: 0, scores: null, rejectReasons: [], confidence: null,
          category: null, groupRank: null, captureTime: r.candidate.captureTime,
          cameraInfo: r.candidate.cameraInfo, asShotWB: r.candidate.asShotWB,
          skinStats: r.candidate.skinStats, analysisComplete: false, missingDimensions: [],
          previewWarning: !r.candidate.preview || r.candidate.preview.isPlaceholder,
          selectionFallback: false, fallbackReason: null, fingerprintId: r.saved.id,
        };
      });
    setPhotos(built);
    setStage("review");
  };

  const doResyncFolder = async () => {
    setResyncing(true);
    try {
      const handle = await resyncFolder(binding.raw_folder_handle_ref);
      await updateCatalogBinding(binding.id, { raw_folder_name: handle.name });
      const s = await checkSync(binding.catalog_handle_ref, binding.raw_folder_handle_ref);
      setSync(s);
      if (s.folderOk) await recoverFromFolder(handle, fingerprints);
      toast({ title: "Carpeta reubicada" });
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "No se pudo reubicar", description: e?.message, variant: "destructive" });
    }
    setResyncing(false);
  };

  const doResyncCatalog = async () => {
    setResyncing(true);
    try {
      const handle = await resyncCatalog(binding.catalog_handle_ref);
      await updateCatalogBinding(binding.id, { catalog_filename: handle.name });
      const s = await checkSync(binding.catalog_handle_ref, binding.raw_folder_handle_ref);
      setSync(s);
      toast({ title: "Catálogo reubicado" });
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "No se pudo reubicar", description: e?.message, variant: "destructive" });
    }
    setResyncing(false);
  };

  // Persiste la selección actual en la base de datos (sobrescribe la anterior por id de
  // fingerprint). silent=true lo usa el auto-guardado (sin toast ni resumen); el botón
  // manual lo llama con showSummary para mostrar el resumen tras confirmar.
  // NUNCA llama a setPhotos: de lo contrario reactivaría el efecto de auto-guardado en bucle.
  const persistSelection = async ({ silent = false, showSummary = false } = {}) => {
    if (!photos.length || !projectId) return;
    if (!silent) setSavingSelection(true);
    try {
      const updates = photos.map((p) => ({
        id: p.fingerprintId,
        selection_status: p.selectedForEdit
          ? (p.status === "TOP_PICK" ? "TOP_PICK" : "SELECT")
          : (p.status === "REJECT" ? "REJECT" : "REVIEW"),
        rating: p.rating || 0,
        color_label: p.colorLabel || "none",
      })).filter((u) => u.id);
      if (!updates.length) return;
      await bulkUpdateFingerprints(updates);
      setFingerprints((prev) => prev.map((f) => {
        const u = updates.find((x) => x.id === f.id);
        return u ? { ...f, selection_status: u.selection_status, rating: u.rating, color_label: u.color_label } : f;
      }));
      const selCount = updates.filter((u) => u.selection_status === "TOP_PICK" || u.selection_status === "SELECT").length;
      await updateProject(projectId, { selection_saved: true, status: "editing", selected_count: selCount });
      setProject((p) => (p ? { ...p, selection_saved: true, status: "editing", selected_count: selCount } : p));
      if (showSummary) setShowProjectSummary(true);
      if (!silent) toast({ title: "Selección guardada", description: `${selCount} de ${photos.length} fotos seleccionadas` });
    } catch (e) {
      if (!silent) toast({ title: "No se pudo guardar", description: e?.message, variant: "destructive" });
    }
    if (!silent) setSavingSelection(false);
  };

  // Auto-guardado: cada vez que la selección cambia en la revisión (IA o ajuste manual),
  // la persiste en segundo plano (con debounce), sobrescribiendo la selección anterior.
  useEffect(() => {
    if (!projectId || stage !== "review" || !photos.length) return;
    if (skipAutoSaveRef.current) { skipAutoSaveRef.current = false; return; }
    const t = setTimeout(() => { persistSelection({ silent: true }); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, stage, projectId]);

  // Ejecuta la misma selección IA que el flujo normal (selectBursts) sobre las fotos
  // recuperadas del proyecto. Reutiliza el motor existente, no crea uno nuevo.
  const runProjectSelection = async () => {
    // Si el proyecto abrió por caché (sin re-extraer la carpeta), projectRawItems está
    // vacío. En ese caso usamos las photos ya cargadas (con su preview cacheada) para
    // que la selección IA funcione sin necesidad de volver a leer los RAW.
    const items = projectRawItems.length ? projectRawItems : photos.map((p) => ({
      id: p.id, file: p.file, preview: p.preview, cameraInfo: p.cameraInfo,
      asShotWB: p.asShotWB, skinStats: p.skinStats, captureTime: p.captureTime,
      // Sin phash, groupIntoScenes degrada a agrupación solo temporal y fusiona todas
      // las fotos en una sola ráfaga → la IA solo analiza un grupo. Sin technical, el
      // fallback pierde métricas. Ambos vienen en las photos cargadas desde caché.
      phash: p.phash, technical: p.technical,
    }));
    if (!items.length) return;
    const fpMap = projectRawItems.length
      ? idToFpId
      : Object.fromEntries(photos.map((p) => [p.id, p.fingerprintId]).filter(([, v]) => v));
    // RESET explícito al volver a seleccionar: TODAS las fotos vuelven a estado neutro
    // (sin selección, rating, etiqueta ni estado anterior) antes de que la IA vuelva a
    // analizarlas. Garantiza que la re-selección parte de cero y no arrastra nada de
    // selecciones previas. El paso a stage="selecting" evita que el auto-guardado persista
    // este reset neutro (se sobrescribe al llegar el nuevo resultado de la IA).
    setPhotos((prev) => prev.map((p) => ({
      ...p,
      aiSelected: false, selectedForEdit: false, colorLabel: "none", rating: 0,
      status: "REVIEW", groupId: null, groupSize: 1, complementary: false,
      reason: null, overallScore: 0, scores: null, rejectReasons: [],
      confidence: null, category: null, groupRank: null, analysisComplete: false,
      selectionFallback: false, fallbackReason: null,
    })));
    setStage("selecting");
    setTotal(items.length);
    setDone(0);
    try {
      const { keep, meta, selection_fallback, fallback_reason, selection_coverage_fallback, coverage_promotions } = await selectBursts(items, (d, t) => {
        setDone(d);
        if (typeof t === "number") setTotal(t);
      });
      const built = items.map((p) => {
        const photo = buildPhotoFromSelection(p, keep, meta);
        return { ...photo, fingerprintId: fpMap[p.id] };
      });
      setPhotos(built);
      setSelectionFallback(selection_fallback ? { active: true, reason: fallback_reason } : null);
      setSelectionCoverage(selection_coverage_fallback ? { active: true, promotions: coverage_promotions || [] } : null);
    } catch (e) {
      setError(e?.message || "No se pudo ejecutar la selección IA");
    }
    setStage("review");
  };

  const goToEditFromProject = () => {
    const queue = photos.filter((p) => p.selectedForEdit);
    if (!queue.length) {
      toast({ title: "Sin fotos seleccionadas", description: "Marca fotos para edición antes de continuar.", variant: "destructive" });
      return;
    }
    setSession({ photos: queue });
    navigate("/ajustes-ia");
  };

  useEffect(() => {
    if (!projectId) return;
    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Sondea el trabajo de procesado que otro dispositivo del mismo usuario está ejecutando:
  // actualiza el progreso en vivo y, cuando termina (o caduca), arranca la recuperación local.
  useEffect(() => {
    if (!remoteJob) return;
    let alive = true;
    const poll = async () => {
      try {
        const jobs = await base44.entities.ProjectProcessingJob.filter({ project_id: projectId, status: "processing" }, "-updated_date", 1);
        const j = jobs?.[0];
        if (!alive) return;
        if (!j) { setRemoteJob(null); startOwnRecovery(binding, fingerprints); return; }
        if (Date.now() - new Date(j.updated_date).getTime() > 120000) {
          try { await base44.entities.ProjectProcessingJob.update(j.id, { status: "failed" }); } catch {}
          setRemoteJob(null);
          startOwnRecovery(binding, fingerprints);
          return;
        }
        setRemoteJob(j);
      } catch {}
    };
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteJob?.id]);

  const toggleColor = (key) => {
    setColorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const update = (id, patch) => setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const visible = useMemo(() => photos.filter((p) => {
    if (quickFilter === "top" && p.status !== "TOP_PICK") return false;
    if (quickFilter === "select" && p.status !== "SELECT") return false;
    if (quickFilter === "review" && p.status !== "REVIEW") return false;
    if (quickFilter === "reject" && p.status !== "REJECT") return false;
    return colorFilter.has(p.colorLabel) && p.rating >= minStars;
  }), [photos, quickFilter, colorFilter, minStars]);

  const selectedCount = photos.filter((p) => p.aiSelected).length;
  const editCount = photos.filter((p) => p.selectedForEdit).length;
  const topCount = photos.filter((p) => p.status === "TOP_PICK").length;
  const reviewCount = photos.filter((p) => p.status === "REVIEW").length;
  const rejectCount = photos.filter((p) => p.status === "REJECT").length;

  const allBulk = visible.length > 0 && bulkIds.size === visible.length;
  const toggleBulk = (id) => setBulkIds((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleBulkAll = () => setBulkIds(() => (allBulk ? new Set() : new Set(visible.map((p) => p.id))));
  const deleteSelected = () => {
    if (!bulkIds.size) return;
    setPhotos((prev) => prev.filter((p) => !bulkIds.has(p.id)));
    setBulkIds(new Set());
  };

  const [downloadingSel, setDownloadingSel] = useState(false);

  // Guarda SOLO metadatos del proyecto en la base de datos (sin previews ni RAW).
  // Permite al fotógrafo volver a ver qué quedó seleccionado entre sesiones; las imágenes
  // hay que recargarlas para volver a procesar.
  const guardarProyecto = async () => {
    if (!photos.length) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const title = window.prompt("Nombre del proyecto", `Selección ${hoy}`);
    if (!title || !title.trim()) return;
    setGuardando(true);
    try {
      await base44.entities.Project.create({
        title: title.trim(),
        event_date: hoy,
        status: "selection",
        photo_count: photos.length,
        selected_count: selectedCount,
        edited_count: 0,
        photos_metadata: photos.map((p) => ({
          filename: p.file.name,
          status: p.status,
          rating: p.rating || 0,
          color_label: p.colorLabel || "none",
          edit_applied: !!p.edit_applied,
        })),
      });
      toast({ title: "Proyecto guardado", description: `${photos.length} fotos · ${selectedCount} seleccionadas` });
    } catch (e) {
      toast({ title: "No se pudo guardar", description: e?.message, variant: "destructive" });
    }
    setGuardando(false);
  };

  const confirmEdit = () => {
    const queue = photos.filter((p) => p.selectedForEdit);
    setSession({ photos: queue });
    navigate("/ajustes-ia");
  };

  // Descarga determinista del XMP de selección: un sidecar por CADA foto. Usa el rating y
  // color REALES de la foto (los que dejó la IA o el fotógrafo en la revisión) y NUNCA los
  // rederiva del estado: así el verde + 5★ que la selección marcó se respetan tal cual en
  // el sidecar y Lightroom los reconoce, sin que ningún paso posterior los sobrescriba.
  // Sin ajustes de revelado, sin IA, sin UploadFile. ZIP vía editflow-engine zip-xmp.
  const downloadSelectionXmp = async () => {
    if (!photos.length) return;
    setDownloadingSel(true);
    try {
      const jobs = photos.map((p) => {
        const rating = p.rating || 0;
        const label = p.colorLabel && p.colorLabel !== "none" ? lightroomLabelFor(p.colorLabel) : null;
        let xmp = SELECTION_XMP_TEMPLATE;
        xmp = addRatingAndLabel(xmp, { rating, label });
        return { filename: p.file.name, xmp_content: xmp };
      });
      const res = await base44.functions.invoke("editflow-engine", { action: "zip-xmp", jobs });
      const url = res?.data?.downloadUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "EditFlowPro-Seleccion.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      setError(e?.message || "Error al generar el ZIP de selección");
    }
    setDownloadingSel(false);
  };

  const reset = () => {
    setFiles([]); setPhotos([]); setStage("idle"); setDone(0); setTotal(0); setError(null); setSelectionFallback(null); setSelectionCoverage(null);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] rounded-xl bg-[#0a0a0a] p-4 sm:p-6 text-zinc-100">
      <p className="text-sm text-zinc-500">{projectId ? "Proyecto" : "Selección IA"}</p>
      <h1 className="mt-1 text-2xl font-semibold">{projectId ? (project?.title || "Proyecto") : "Selección y culling de bodas"}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
        {projectId
          ? "Recupera las fotos del proyecto y su selección guardada. Modifica, guarda y pasa a edición."
          : "Importa la carpeta, la IA agrupa ráfagas y marca en verde las mejores tomas, revisa y confirma la cola de edición. Los RAW nunca se modifican ni se suben."}
      </p>

      {!projectId && stage === "idle" && (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-700 bg-[#141414] p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-zinc-500" />
          <p className="mt-3 text-sm text-zinc-400">Elige la carpeta de RAW a analizar</p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
            <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
            <input type="file" className="hidden" webkitdirectory="" directory="" multiple
              onChange={(e) => onPick(e.target.files)} />
          </label>
          <label className="mt-2 block text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
            o selecciona archivos sueltos
            <input type="file" className="hidden" multiple
              onChange={(e) => onPick(e.target.files)} />
          </label>
        </div>
      )}

      {(stage === "previews" || stage === "selecting") && (
        <section className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <p className="text-sm font-medium">
            {stage === "previews" ? "Leyendo previews embebidas" : "Analizando ráfagas con IA"}
          </p>
          <p className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {done} / {total}
          </p>
        </section>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {stage === "review" && !(projectId && showProjectSummary) && (
        <section className="mt-6 flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-[#141414] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {projectId
                    ? `Revisión — ${photos.length} fotos del proyecto · ${editCount} en cola de edición`
                    : `Revisión — ${selectedCount} / ${photos.length} seleccionadas por la IA`}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  <span className="text-amber-400">{topCount} top picks</span> ·{" "}
                  <span className="text-emerald-400">{selectedCount} seleccionadas</span> ·{" "}
                  <span className="text-yellow-500">{reviewCount} a revisar</span> ·{" "}
                  <span className="text-red-400">{rejectCount} descartadas</span> ·{" "}
                  <span className="text-emerald-400">{editCount} en cola de edición</span>
                </p>
                {projectId && sync && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {sync.folderOk ? "🟢 Carpeta RAW sincronizada" : "🔴 Carpeta RAW no accesible"}
                    {binding?.catalog_handle_ref && (sync.catalogOk ? " · 🟢 Catálogo sincronizado" : " · 🔴 Catálogo no accesible")}
                  </p>
                )}
                {!projectId && selectionCoverage?.active && (
                  <p className="mt-2 text-xs text-amber-300">
                    selection_coverage_fallback=true · {selectionCoverage.promotions.length} grupo(s) sin representante: {selectionCoverage.promotions.map((p) => `coverage_fallback_group=${p.group} coverage_fallback_photo=${p.photo} (${p.reason})`).join(" · ")}
                  </p>
                )}
                {!projectId && selectionFallback?.active && (
                  <p className="mt-2 text-xs text-amber-300">
                    selection_fallback=true · fallback_reason={selectionFallback.reason} — la IA no devolvió TOP_PICK; se promocionó deterministamente la mejor candidata (sin nueva llamada IA, sin créditos).
                  </p>
                )}
              </div>
              <button onClick={() => (projectId ? navigate("/proyectos") : reset())}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
                <RotateCcw className="h-3.5 w-3.5" /> {projectId ? "Mis proyectos" : "Otra carpeta"}
              </button>
            </div>

            {/* Toolbar: selección múltiple + eliminar + slider de tamaño */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={toggleBulkAll}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800">
                {allBulk ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                {allBulk ? "Quitar selección" : "Seleccionar todas"}
              </button>
              <span className="text-xs text-zinc-500">{bulkIds.size} marcadas</span>
              <button type="button" onClick={deleteSelected} disabled={!bulkIds.size}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-zinc-800 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </button>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-zinc-500">Tamaño</span>
                <input type="range" min={2} max={12} value={14 - gridCols} onChange={(e) => setGridCols(14 - Number(e.target.value))} className="w-32 accent-white" />
              </div>
            </div>

            <div className="mt-3">
              <ReviewFilters quickFilter={quickFilter} onQuickFilter={setQuickFilter} colorFilter={colorFilter}
                onToggleColor={toggleColor} minStars={minStars} onMinStars={setMinStars} />
            </div>

            <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
              {visible.map((p, vi) => (
                <PhotoCard key={p.id} photo={p} onUpdate={(patch) => update(p.id, patch)}
                  bulkSelected={bulkIds.has(p.id)} onToggleBulk={() => toggleBulk(p.id)}
                  onOpen={() => setLightboxIndex(vi)} />
              ))}
            </div>
            {!visible.length && <p className="mt-6 text-sm text-zinc-500">No hay fotos con estos filtros.</p>}
          </div>

          {/* Barra lateral derecha: Guardar / Selección / Editar con sus rutas */}
          <aside className="w-full shrink-0 lg:w-60">
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-[#141414] p-4">
              <p className="text-xs font-semibold text-zinc-400">Acciones</p>
              {projectId ? (
                <>
                  <button onClick={runProjectSelection} disabled={!photos.length || stage === "selecting"}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
                    {stage === "selecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Selección
                  </button>
                  <button onClick={() => persistSelection({ showSummary: true })} disabled={!photos.length || savingSelection}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-black disabled:opacity-40">
                    {savingSelection ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Guardar
                  </button>
                  <button onClick={goToEditFromProject} disabled={!editCount}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
                    Editar ({editCount}) <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <button onClick={downloadSelectionXmp} disabled={!photos.length || downloadingSel}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
                    {downloadingSel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Descargar XMP
                  </button>
                  <button onClick={guardarProyecto} disabled={!photos.length || guardando}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-black disabled:opacity-40">
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Guardar
                  </button>
                  <button onClick={confirmEdit} disabled={!editCount}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
                    Editar ({editCount}) <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </aside>
        </section>
      )}

      {projectId && projectLoading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando proyecto…
        </div>
      )}

      {projectId && !projectLoading && showProjectSummary && (
        <SelectionSummary
          fingerprints={fingerprints}
          onBackToSelection={() => setShowProjectSummary(false)}
          onGoToEdit={goToEditFromProject}
          editDisabled={!sync?.folderOk}
        />
      )}

      {projectId && !projectLoading && !showProjectSummary && stage !== "review" && recovering && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Recuperando fotos de la carpeta…</span>
            <span className="font-mono font-semibold tabular-nums text-zinc-200">{recoverPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-white transition-all duration-150" style={{ width: `${recoverPct}%` }} />
          </div>
        </div>
      )}

      {projectId && !projectLoading && !showProjectSummary && stage !== "review" && remoteJob && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">
              Procesando en otro dispositivo… {remoteJob.phase === "fingerprinting" ? "calculando huellas" : "leyendo previews"}
            </span>
            <span className="font-mono font-semibold tabular-nums text-zinc-200">{remoteJob.progress || 0}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-white transition-all duration-300" style={{ width: `${remoteJob.progress || 0}%` }} />
          </div>
          <p className="text-xs text-zinc-500">Sigue el proceso en tiempo real. Al terminar, las fotos se cargarán aquí automáticamente.</p>
        </div>
      )}

      {projectId && !projectLoading && !showProjectSummary && stage !== "review" && !recovering && !remoteJob && (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-700 bg-[#141414] p-8 text-center space-y-3">
          {sync && !sync.folderOk && !sync.folderHandle ? (
            <>
              <p className="text-sm text-zinc-300">Este proyecto se gestiona desde otro equipo.</p>
              <p className="text-xs text-zinc-500">
                Las fotos viven en la carpeta RAW del equipo donde se creó el proyecto. Si se está procesando allí, verás el progreso aquí en tiempo real; para editarlas, abre el proyecto en ese equipo.
              </p>
              <button onClick={doResyncFolder}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
                <FolderOpen className="h-3.5 w-3.5" /> Reubicar carpeta en este dispositivo
              </button>
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              {sync && !sync.folderOk ? "No se pudieron recuperar las fotos: la carpeta RAW no está accesible." : "Sin fotos recuperadas."}
            </p>
          )}
        </div>
      )}

      <LocationNotFoundModal
        missingFolder={!!binding && !!sync && !sync.folderOk && !!sync.folderHandle}
        missingCatalog={!!binding && !!binding.catalog_handle_ref && !!sync && !sync.catalogOk && !!sync.catalogHandle}
        onRelocateFolder={doResyncFolder}
        onRelocateCatalog={doResyncCatalog}
        loading={resyncing}
      />

      {lightboxIndex != null && (
        <Lightbox
          images={visible.map((p) => ({ url: p.preview?.dataUrl, filename: p.file.name }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i < visible.length - 1 ? i + 1 : i))}
        />
      )}
    </div>
  );
}