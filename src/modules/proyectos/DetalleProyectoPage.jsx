import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Save, Undo2, Redo2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getProject, getCatalogBinding, listFingerprints, updateProject, updateCatalogBinding, bulkUpdateFingerprints } from "./hooks/useProjectStore";
import { useFileSync } from "./hooks/useFileSync";
// Solo IMPORTA (no modifica) utilidades del motor de Selección existente.
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { computeFingerprint, matchFingerprints, statusMeta, SELECTION_CYCLE } from "./lib/projectFingerprint";
import { buildSelectedPhotosArray, loadSelectionIntoSession } from "./lib/recoverSelection";
import SyncStatusCard from "./components/SyncStatusCard";
import LocationNotFoundModal from "./components/LocationNotFoundModal";
import SelectionSummary from "./components/SelectionSummary";
import PhotoFingerprintGrid from "./components/PhotoFingerprintGrid";
import { useToast } from "@/components/ui/use-toast";
import useUndoRedo from "@/hooks/useUndoRedo";
import { takePendingProjectPreviews } from "@/lib/rawaistudio/localSession";
import { getCachedPreviews } from "./lib/previewCache";

// Reabre un proyecto: comprueba accesibilidad de carpeta RAW y .lrcat (🟢/🟡/🔴, de forma
// independiente de la selección), y si la carpeta sigue accesible re-extrae previews y
// recupera automáticamente la identidad guardada por fingerprint. Nunca mueve, copia,
// modifica ni sube archivos.
//
// Punto de continuidad del proyecto: si ya existe una selección guardada (selection_saved)
// muestra el RESUMEN persistente con [Volver a selección] / [Pasar a edición]; si no,
// muestra directamente la interfaz de selección con [Guardar selección].
export default function DetalleProyectoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { checking, checkSync, resyncFolder, resyncCatalog } = useFileSync();

  const [project, setProject] = useState(null);
  const [binding, setBinding] = useState(null);
  const [fingerprints, setFingerprints] = useState([]);
  const [sync, setSync] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [mode, setMode] = useState("select"); // "select" | "summary"
  const [statusDraft, setStatusDraft] = useState({});
  // Historial de cambios de estado de las fotos: ⌘Z deshace, ⌘Y rehace.
  const statusDraftRef = useRef(statusDraft); statusDraftRef.current = statusDraft;
  const { record, undo, redo, canUndo, canRedo } = useUndoRedo({
    getSnapshot: () => statusDraftRef.current,
    applySnapshot: (s) => setStatusDraft(s),
  });
  const [saving, setSaving] = useState(false);
  const [previewByHash, setPreviewByHash] = useState(new Map());

  // Empareja los fingerprints guardados con una lista de candidatos (con previews ya
  // disponibles) y los enriquece con el lr_local_id del catálogo si el plugin lo recopiló.
  const applyCandidates = async (savedFingerprints, candidateList) => {
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "lr-catalog-ids" });
      const catalogPhotos = res?.data?.photos || [];
      if (catalogPhotos.length) {
        const byFileName = new Map(catalogPhotos.map((p) => [String(p.fileName || "").toLowerCase(), p.localId]));
        candidateList.forEach((c) => {
          const lrId = byFileName.get(String(c.filename || "").toLowerCase());
          if (lrId) c.lr_local_id = lrId;
        });
      }
    } catch {
      // Sin plugin configurado todavía: se ignora, la desambiguación cae a revisión manual.
    }
    const result = matchFingerprints(savedFingerprints, candidateList);
    setMatches(result);
    const flagged = result.filter((r) => r.ambiguous).map((r) => ({ id: r.saved.id, needs_review: true }));
    const lrIdUpdates = result
      .filter((r) => r.matched && r.candidate?.lr_local_id && !r.saved.lr_local_id)
      .map((r) => ({ id: r.saved.id, lr_local_id: r.candidate.lr_local_id }));
    if (flagged.length) await bulkUpdateFingerprints(flagged);
    if (lrIdUpdates.length) await bulkUpdateFingerprints(lrIdUpdates);
  };

  // Re-extrae previews de la carpeta RAW y recalcula fingerprints. Solo se usa al reabrir
  // un proyecto existente (sin previews en sesión); al crear, las previews ya están disponibles.
  const recoverFromFolder = async (folderHandle, savedFingerprints) => {
    const raws = [];
    for await (const [name, entryHandle] of folderHandle.entries()) {
      if (entryHandle.kind !== "file") continue;
      if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
      raws.push(await entryHandle.getFile());
    }
    const inputItems = raws.map((f, i) => ({ id: String(i), file: f }));
    const withPreview = await extractPreviews(inputItems, () => {}, () => {});
    const candidateList = await Promise.all(
      withPreview.map(async (p) => {
        const fingerprint = await computeFingerprint({ file: p.file, preview: p.preview, relativePath: p.file.name });
        return {
          id: p.id,
          file: p.file,
          preview: p.preview,
          cameraInfo: p.cameraInfo,
          asShotWB: p.asShotWB,
          skinStats: p.skinStats,
          ...fingerprint,
        };
      })
    );
    await applyCandidates(savedFingerprints, candidateList);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [p, b, fps] = await Promise.all([getProject(id), getCatalogBinding(id), listFingerprints(id)]);
    setProject(p);
    setBinding(b);
    setFingerprints(fps);
    setMode(p?.selection_saved ? "summary" : "select");
    setStatusDraft({});
    // Previews cacheadas en IndexedDB: cargan casi al instante para mostrar las imágenes
    // sin esperar a re-extraerlas de la carpeta RAW.
    try {
      const cached = await getCachedPreviews(fps.map((f) => f.fingerprint_hash).filter(Boolean));
      setPreviewByHash(cached);
    } catch {
      // Sin caché todavía: las previews llegarán tras la recuperación en segundo plano.
    }
    // Muestra el proyecto al instante con los datos ya guardados.
    setLoading(false);
    // Previews ya extraídas al crear el proyecto: se reutilizan sin volver a procesarlas.
    const stashed = takePendingProjectPreviews(id);
    if (stashed?.length) {
      const candidateList = stashed.map((p, i) => ({
        id: String(i),
        preview: p.preview,
        cameraInfo: p.cameraInfo,
        asShotWB: p.asShotWB,
        skinStats: p.skinStats,
        ...p.fingerprint,
      }));
      (async () => {
        try { await applyCandidates(fps, candidateList); } catch {}
      })();
    }
    if (b) {
      (async () => {
        try {
          const s = await checkSync(b.catalog_handle_ref, b.raw_folder_handle_ref);
          setSync(s);
          // Solo re-extrae si no había previews en sesión (reabrir un proyecto existente).
          if (s.folderOk && s.folderHandle && !stashed?.length) await recoverFromFolder(s.folderHandle, fps);
        } catch {
          // Sin acceso a la carpeta: el usuario puede re-sincronizar manualmente.
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, checkSync]);

  useEffect(() => {
    load();
  }, [load]);

  const doResyncFolder = async () => {
    setResyncing(true);
    try {
      const handle = await resyncFolder(binding.raw_folder_handle_ref);
      await updateCatalogBinding(binding.id, { raw_folder_name: handle.name });
      const s = await checkSync(binding.catalog_handle_ref, binding.raw_folder_handle_ref);
      setSync(s);
      await recoverFromFolder(handle, fingerprints);
      toast({ title: "Carpeta RAW re-sincronizada" });
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "No se pudo re-sincronizar", description: e?.message, variant: "destructive" });
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
      toast({ title: "Catálogo re-sincronizado" });
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "No se pudo re-sincronizar", description: e?.message, variant: "destructive" });
    }
    setResyncing(false);
  };

  const cycleStatus = (fpId) => {
    record();
    setStatusDraft((prev) => {
      const current = prev[fpId] ?? fingerprints.find((f) => f.id === fpId)?.selection_status ?? "REVIEW";
      return { ...prev, [fpId]: SELECTION_CYCLE[current] || "REVIEW" };
    });
  };

  const saveSelection = async () => {
    setSaving(true);
    try {
      const updates = fingerprints.map((f) => {
        const status = statusDraft[f.id] ?? f.selection_status;
        return { id: f.id, selection_status: status, ...statusMeta(status) };
      });
      await bulkUpdateFingerprints(updates);
      const updatedFingerprints = fingerprints.map((f) => ({ ...f, ...updates.find((u) => u.id === f.id) }));
      setFingerprints(updatedFingerprints);
      setMatches((prev) => prev.map((m) => ({ ...m, saved: updatedFingerprints.find((f) => f.id === m.saved.id) || m.saved })));
      const selCount = updates.filter((u) => u.selection_status === "TOP_PICK" || u.selection_status === "SELECT").length;
      await updateProject(project.id, { selection_saved: true, status: "editing", selected_count: selCount });
      setProject((p) => ({ ...p, selection_saved: true, status: "editing", selected_count: selCount }));
      setStatusDraft({});
      setMode("summary");
      toast({ title: "Selección guardada", description: `${selCount} de ${fingerprints.length} fotos seleccionadas` });
    } catch (e) {
      toast({ title: "No se pudo guardar la selección", description: e?.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const goToEdit = () => {
    const selected = buildSelectedPhotosArray(matches);
    if (!selected.length) {
      toast({
        title: "Sin fotos seleccionadas recuperadas",
        description: "Verifica que la carpeta RAW esté sincronizada y que haya fotos en Top pick/Seleccionada.",
        variant: "destructive",
      });
      return;
    }
    loadSelectionIntoSession(selected);
    navigate("/ajustes-ia");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando proyecto…
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm text-muted-foreground">Proyecto no encontrado.</p>;
  }

  const ambiguousCount = matches.filter((m) => m.ambiguous).length;
  const missingFolder = !!binding && !!sync && !sync.folderOk;
  const missingCatalog = !!binding && !!binding.catalog_handle_ref && !!sync && !sync.catalogOk;

  const gridItems = fingerprints.map((f) => {
    const m = matches.find((mm) => mm.saved.id === f.id);
    return {
      id: f.id,
      filename: f.filename,
      status: statusDraft[f.id] ?? f.selection_status,
      previewUrl: m?.candidate?.preview?.dataUrl || previewByHash.get(f.fingerprint_hash),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.event_date || "Sin fecha"} · {fingerprints.length} fotos registradas
          </p>
        </div>
        <button
          onClick={() => navigate("/proyectos")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Mis proyectos
        </button>
      </div>

      {binding && sync && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SyncStatusCard
            title="Carpeta RAW"
            status={sync.folderOk ? "synced" : sync.catalogOk ? "partial" : "missing"}
            message={sync.folderOk ? binding.raw_folder_name : "No accesible"}
          />
          <SyncStatusCard
            title="Catálogo Lightroom"
            status={sync.catalogOk ? "synced" : sync.folderOk ? "partial" : "missing"}
            message={sync.catalogOk ? binding.catalog_filename || "No asociado" : "No accesible"}
          />
        </div>
      )}

      <LocationNotFoundModal
        missingFolder={missingFolder}
        missingCatalog={missingCatalog}
        onRelocateFolder={doResyncFolder}
        onRelocateCatalog={doResyncCatalog}
        loading={resyncing || checking}
      />

      {ambiguousCount > 0 && (
        <p className="text-xs text-yellow-500">
          {ambiguousCount} foto(s) con emparejamiento ambiguo — marcadas para revisión manual, no se recuperaron automáticamente.
        </p>
      )}

      {mode === "summary" ? (
        <SelectionSummary
          fingerprints={fingerprints}
          onBackToSelection={() => setMode("select")}
          onGoToEdit={goToEdit}
          editDisabled={!sync?.folderOk}
        />
      ) : (
        <div className="space-y-4">
          {!project.selection_saved && (
            <p className="text-sm text-muted-foreground">Este proyecto todavía no tiene una selección guardada.</p>
          )}
          <p className="text-sm text-muted-foreground">
            {fingerprints.length} fotografías disponibles · toca cada tarjeta para cambiar su estado.
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Deshacer (⌘Z)"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" /> Deshacer
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Rehacer (⌘Y)"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
            >
              <Redo2 className="h-3.5 w-3.5" /> Rehacer
            </button>
          </div>
          <PhotoFingerprintGrid items={gridItems} onCycleStatus={cycleStatus} />
          <button
            onClick={saveSelection}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar selección
          </button>
        </div>
      )}
    </div>
  );
}