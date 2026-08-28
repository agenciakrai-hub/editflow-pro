import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, FileText, Loader2, Save, ArrowLeft } from "lucide-react";
// Solo IMPORTA (no modifica) utilidades del motor de Selección existente.
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { computeFingerprint, statusMeta, SELECTION_CYCLE } from "./lib/projectFingerprint";
import { saveHandle } from "./lib/idbHandles";
import { createProject, createCatalogBinding, bulkCreateFingerprints } from "./hooks/useProjectStore";
import PhotoFingerprintGrid from "./components/PhotoFingerprintGrid";
import { useToast } from "@/components/ui/use-toast";
import { setPendingProjectPreviews } from "@/lib/rawaistudio/localSession";
import { cachePreviews } from "./lib/previewCache";

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

  const save = async () => {
    if (!title.trim()) {
      toast({ title: "Falta el nombre del proyecto", variant: "destructive" });
      return;
    }
    if (!folderHandle || !items.length) {
      toast({ title: "Selecciona la carpeta RAW primero", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const folderRef = await saveHandle(folderHandle, "directory", { name: folderHandle.name });
      const catalogRef = catalogHandle ? await saveHandle(catalogHandle, "file", { name: catalogHandle.name }) : null;

      const selCount = items.filter((it) => it.status === "TOP_PICK" || it.status === "SELECT").length;
      // La propia creación ya es la primera pasada de selección + guardado: al abrir el
      // proyecto en Detalle debe verse directamente el resumen, no la interfaz de selección.
      const project = await createProject({
        title: title.trim(),
        event_date: eventDate || undefined,
        status: "editing",
        selection_saved: true,
        photo_count: items.length,
        selected_count: selCount,
        lightroom_catalog_name: catalogHandle?.name || "",
        raw_folder_path: folderHandle.name,
      });

      await createCatalogBinding({
        project_id: project.id,
        catalog_handle_ref: catalogRef || "",
        raw_folder_handle_ref: folderRef,
        catalog_filename: catalogHandle?.name || "",
        raw_folder_name: folderHandle.name,
      });

      await bulkCreateFingerprints(
        items.map((it) => ({
          project_id: project.id,
          fingerprint_hash: it.fingerprint.fingerprint_hash,
          filename: it.fingerprint.filename,
          relative_path: it.fingerprint.relative_path,
          capture_time: it.fingerprint.capture_time,
          camera_make: it.fingerprint.camera_make,
          camera_model: it.fingerprint.camera_model,
          file_size: it.fingerprint.file_size,
          selection_status: it.status,
          ...statusMeta(it.status),
        }))
      );

      // Pasa las previews ya extraídas al detalle para no volver a procesarlas al abrir.
      setPendingProjectPreviews(
        project.id,
        items.map((it) => ({
          filename: it.file.name,
          preview: it.preview,
          cameraInfo: it.cameraInfo,
          asShotWB: it.asShotWB,
          skinStats: it.skinStats,
          fingerprint: it.fingerprint,
          status: it.status,
        }))
      );
      toast({ title: "Proyecto guardado", description: `${items.length} fotos · ${selCount} seleccionadas` });
      navigate(`/proyectos/${project.id}`);
    } catch (e) {
      toast({ title: "No se pudo guardar", description: e?.message, variant: "destructive" });
    }
    setSaving(false);
  };

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
            <FileText className="h-4 w-4" /> {catalogHandle ? catalogHandle.name : "Seleccionar catálogo .lrcat"}
          </button>
          <button onClick={pickFolder} className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary">
            <FolderOpen className="h-4 w-4" /> {folderHandle ? folderHandle.name : "Seleccionar carpeta RAW"}
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
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {items.length} fotos · toca cada tarjeta para cambiar su estado (A revisar → Seleccionada → Top pick → Descartada).
          </p>
          <PhotoFingerprintGrid
            items={items.map((it) => ({ id: it.id, filename: it.file.name, status: it.status, previewUrl: it.preview?.dataUrl }))}
            onCycleStatus={cycleStatus}
          />
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar proyecto
          </button>
        </div>
      )}
    </div>
  );
}