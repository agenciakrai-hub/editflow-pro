import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, FileText, Loader2, ArrowLeft } from "lucide-react";
// Solo IMPORTA (no modifica) utilidades del motor de Selección existente.
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { computeFingerprint, statusMeta, SELECTION_CYCLE } from "./lib/projectFingerprint";
import { saveHandle, getHandleRecord } from "./lib/idbHandles";
import { createProject, createCatalogBinding, bulkCreateFingerprints, getProject, getCatalogBinding, listFingerprints, updateProject, updateCatalogBinding, deleteFingerprintsByProject } from "./hooks/useProjectStore";
import ProjectPhotoWorkspace from "./components/ProjectPhotoWorkspace";
import { useToast } from "@/components/ui/use-toast";
import { setPendingProjectPreviews } from "@/lib/rawaistudio/localSession";
import { cachePreviews, getCachedPreviews } from "./lib/previewCache";

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
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [phase, setPhase] = useState("extracting");
  // Selección múltiple para eliminar + densidad del grid.
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [gridCols, setGridCols] = useState(5);
  // Reabrir un proyecto existente: «Abrir» (Mis proyectos) llega con ?project=<id> y
  // carga en ESTA MISMA página los datos guardados — nombre, fecha, catálogo/carpeta
  // y las fotos con sus estados — para continuar exactamente donde se dejó.
  const projectIdParam = new URLSearchParams(window.location.search).get("project");
  const [existing, setExisting] = useState(null);
  const [restoredHandles, setRestoredHandles] = useState({ folder: null, catalog: null });

  useEffect(() => {
    if (!projectIdParam) return;
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
        const loaded = fps.map((f) => ({
          id: f.id,
          file: { name: f.filename },
          status: f.selection_status || "REVIEW",
          fingerprint: f,
          preview: previewByHash.has(f.fingerprint_hash) ? { dataUrl: previewByHash.get(f.fingerprint_hash) } : null,
        }));
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

  const extractFromFolder = async (handle) => {
    setExtracting(true);
    setPhase("extracting");
    setProgress({ done: 0, total: 0 });
    const raws = [];
    for await (const [name, entryHandle] of handle.entries()) {
      if (entryHandle.kind !== "file") continue;
      if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
      raws.push(await entryHandle.getFile());
    }
    const count = raws.length;
    const total = count * 2;
    setProgress({ done: 0, total });
    const inputItems = raws.map((f, i) => ({ id: String(i), file: f }));
    const withPreview = await extractPreviews(
      inputItems,
      (done) => setProgress({ done, total }),
      () => {}
    );
    setPhase("fingerprinting");
    const withFingerprint = [];
    for (let i = 0; i < withPreview.length; i++) {
      const p = withPreview[i];
      withFingerprint.push({
        ...p,
        status: "REVIEW",
        fingerprint: await computeFingerprint({ file: p.file, preview: p.preview, relativePath: p.file.name }),
      });
      setProgress({ done: count + i + 1, total });
    }
    // Cachea las previews en IndexedDB para que reabrir el proyecto sea instantáneo.
    cachePreviews(
      withFingerprint.map((p) => ({ hash: p.fingerprint?.fingerprint_hash, dataUrl: p.preview?.dataUrl }))
    ).catch(() => {});
    setItems(withFingerprint);
    // Por defecto TODAS las fotos quedan marcadas (checkbox) al subir la carpeta:
    // el fotógrafo parte de la selección completa y desmarca solo lo que no quiera.
    setSelectedIds(new Set(withFingerprint.map((p) => p.id)));
    setExtracting(false);
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
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: SELECTION_CYCLE[it.status] || "REVIEW" } : it)));
  };

  const toggleSelect = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => (prev.size === items.length ? new Set() : new Set(items.map((it) => it.id))));

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
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
      // marcadas sin curar (REVIEW) suben a SELECT (5 estrellas + etiqueta verde);
      // la curación manual del botón «A revisar» siempre prevalece si existe.
      const effStatus = (it) => (selectedIds.has(it.id) && it.status === "REVIEW" ? "SELECT" : it.status);
      const selCount = items.filter((it) => ["TOP_PICK", "SELECT"].includes(effStatus(it))).length;
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
        }
        await deleteFingerprintsByProject(existing.projectId);
      } else {
        await createCatalogBinding({
          project_id: savedId,
          catalog_handle_ref: catalogRef || "",
          raw_folder_handle_ref: folderRef,
          catalog_filename: catalogHandle?.name || "",
          raw_folder_name: folderHandle.name,
        });
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
          ...statusMeta(effStatus(it)),
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

  const goSeleccion = async () => {
    const id = await save();
    if (id) navigate(`/dashboard?project=${id}`);
  };
  const goEditar = async () => {
    const id = await save();
    if (id) navigate("/ajustes-ia");
  };
  const goAlbum = async () => {
    const id = await save();
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

      {!extracting && items.length > 0 && (
        <ProjectPhotoWorkspace
          items={items.map((it) => ({
            id: it.id,
            filename: it.file.name,
            status: it.status,
            previewUrl: it.preview?.dataUrl,
            // Datos para ordenar: hora de captura (epoch ms) y cámara (marca + modelo).
            captureTime: it.fingerprint?.capture_time,
            camera: [it.fingerprint?.camera_make, it.fingerprint?.camera_model].filter(Boolean).join(" "),
          }))}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onDeleteSelected={deleteSelected}
          onCycleStatus={cycleStatus}
          gridCols={gridCols}
          onGridCols={setGridCols}
          saving={saving}
          onSave={save}
          onGoSeleccion={goSeleccion}
          onGoEditar={goEditar}
          onGoAlbum={goAlbum}
        />
      )}
    </div>
  );
}