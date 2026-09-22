import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, FolderOpen, Plus, Loader2, Trash2, Pencil, ChevronUp, ChevronDown, Check, X, CheckCircle2, Circle, CircleDot, AlertCircle, RotateCcw, Film } from "lucide-react";
import { getProject, ensureFoldersMigrated, createFolder, updateFolder, deleteFolder, deleteFingerprintsByFolder } from "../hooks/useProjectStore";
import { startProcessing, getJob, subscribe } from "../lib/backgroundProcessor";
import { getJob as getAiJob, subscribe as subscribeAi, cancelSelection as cancelAiSelection } from "../lib/backgroundAiSelection";
import { saveHandle, getHandleRecord } from "../lib/idbHandles";
import { useToast } from "@/components/ui/use-toast";

// Centro de trabajo del proyecto: muestra las carpetas/sesiones independientes.
// Cada carpeta tiene sus propias fotos, selección y edición (estado independiente).
// Los RAW nunca se suben: el procesado es local-first (previews + fingerprints).
export default function ProjectFoldersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState(null);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [folderName, setFolderName] = useState("");
  // Progreso en vivo por carpeta: { [folderId]: { done, total, phase, status } }.
  // total = fotos * 2 (fase extracting + fingerprinting); fotos detectadas = total/2.
  const [jobProgress, setJobProgress] = useState({});
  // Progreso en vivo de selección IA por carpeta: { [folderId]: { done, total, status } }.
  const [aiProgress, setAiProgress] = useState({});
  const folderInputRef = useRef(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const p = await getProject(id);
      setProject(p);
      const folders = await ensureFoldersMigrated(id);
      // Detecta carpetas "processing" stale: si no hay job activo en memoria, el
      // procesado se interrumpió (pestaña cerrada, navegación fuera). Se marcan como
      // "failed" para que el usuario pueda reintentar con el botón «Reintentar».
      const stale = folders.filter((f) => f.import_status === "processing" && !getJob(id, f.id));
      if (stale.length > 0) {
        await Promise.all(stale.map((f) =>
          updateFolder(f.id, { import_status: "failed", last_modified: new Date().toISOString() }).catch(() => {})
        ));
        stale.forEach((f) => { f.import_status = "failed"; });
      }
      setFolders(folders.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)));
    } catch (e) {
      toast({ title: "No se pudo cargar el proyecto", description: e?.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  // Suscribe a jobs de carpetas en procesamiento para actualizar tarjetas en vivo.
  const processingIds = folders.filter((f) => f.import_status === "processing").map((f) => f.id).join(",");
  useEffect(() => {
    if (!processingIds) return;
    const ids = processingIds.split(",");
    const unsubs = ids.map((fid) =>
      subscribe(id, fid, (job) => {
        setJobProgress((prev) => ({ ...prev, [fid]: { done: job.progress?.done || 0, total: job.progress?.total || 0, phase: job.phase, status: job.status } }));
        if (job.status === "completed") {
          setFolders((prev) => prev.map((f) => f.id === fid ? { ...f, import_status: "completed", photo_count: job.items?.length || f.photo_count } : f));
          setJobProgress((prev) => { const next = { ...prev }; delete next[fid]; return next; });
        } else if (job.status === "failed") {
          setFolders((prev) => prev.map((f) => f.id === fid ? { ...f, import_status: "failed" } : f));
          setJobProgress((prev) => { const next = { ...prev }; delete next[fid]; return next; });
        }
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [id, processingIds]);

  // Suscribe a jobs de selección IA en segundo plano para mostrar progreso en vivo
  // en las tarjetas de carpeta. El usuario ve qué carpeta se está seleccionando sin
  // necesidad de abrirla, y puede cancelar directamente desde aquí.
  const aiSelectionIds = folders.filter((f) => getAiJob(id, f.id)?.status === "running").map((f) => f.id).join(",");
  useEffect(() => {
    if (!aiSelectionIds) return;
    const ids = aiSelectionIds.split(",");
    const unsubs = ids.map((fid) =>
      subscribeAi(id, fid, (job) => {
        setAiProgress((prev) => {
          const next = { ...prev };
          if (job.status === "running") {
            next[fid] = { done: job.done, total: job.total, status: job.status };
          } else {
            delete next[fid];
            if (job.status === "completed") {
              setFolders((prev2) => prev2.map((x) => x.id === fid ? { ...x, selection_status: "completed" } : x));
            } else if (job.status === "canceled" || job.status === "failed") {
              setFolders((prev2) => prev2.map((x) => x.id === fid ? { ...x, selection_status: "pending" } : x));
            }
          }
          return next;
        });
      })
    );
    // Inicializa el progreso para los jobs ya activos.
    const initial = {};
    ids.forEach((fid) => {
      const job = getAiJob(id, fid);
      if (job) initial[fid] = { done: job.done, total: job.total, status: job.status };
    });
    if (Object.keys(initial).length > 0) setAiProgress((prev) => ({ ...prev, ...initial }));
    return () => unsubs.forEach((u) => u());
  }, [id, aiSelectionIds]);

  const addFolder = async () => {
    if (typeof window.showDirectoryPicker === "function") {
      try {
        const handle = await window.showDirectoryPicker();
        await processNewFolder(handle, handle.name, null);
      } catch {}
      return;
    }
    folderInputRef.current?.click();
  };

  const onFolderPicked = async (e) => {
    const files = e.target.files;
    if (e.target) e.target.value = "";
    if (!files || !files.length) return;
    const first = files[0];
    const relPath = first.webkitRelativePath || first.name;
    const name = relPath.includes("/") ? relPath.split("/")[0] : "Carpeta";
    await processNewFolder(null, name, files);
  };

  const processNewFolder = async (handle, name, files = null) => {
    setAdding(true);
    try {
      const orderIndex = folders.length;
      const displayName = `${String(orderIndex + 1).padStart(2, "0")} - ${name}`;
      const folder = await createFolder({
        project_id: id,
        name: displayName,
        order_index: orderIndex,
        raw_folder_name: name,
        raw_folder_handle_ref: handle ? await saveHandle(handle, "directory", { name }) : "",
        import_status: "processing",
        selection_status: "pending",
        edit_status: "pending",
        last_modified: new Date().toISOString(),
      });
      setFolders((prev) => [...prev, folder]);
      startProcessing({
        folderHandle: handle,
        files,
        folderName: name,
        folderId: folder.id,
        projectId: id,
        onProgress: (job) => {
          setJobProgress((prev) => ({ ...prev, [folder.id]: { done: job.progress?.done || 0, total: job.progress?.total || 0, phase: job.phase, status: job.status } }));
        },
        onComplete: (job) => {
          setFolders((prev) => prev.map((f) => f.id === folder.id ? { ...f, import_status: "completed", photo_count: job.items?.length || 0 } : f));
          toast({ title: "Carpeta importada", description: `${job.items?.length || 0} fotos procesadas en "${displayName}".` });
        },
        onError: (e) => {
          setFolders((prev) => prev.map((f) => f.id === folder.id ? { ...f, import_status: "failed" } : f));
          toast({ title: "Error al importar carpeta", description: e?.message, variant: "destructive" });
        },
      });
    } catch (e) {
      toast({ title: "No se pudo añadir la carpeta", description: e?.message, variant: "destructive" });
    }
    setAdding(false);
  };

  const startRename = (f) => { setRenaming(f.id); setFolderName(f.name); };
  const confirmRename = async () => {
    if (!folderName.trim() || !renaming) return;
    try {
      await updateFolder(renaming, { name: folderName.trim(), last_modified: new Date().toISOString() });
      setFolders((prev) => prev.map((f) => f.id === renaming ? { ...f, name: folderName.trim() } : f));
    } catch (e) {
      toast({ title: "No se pudo renombrar", description: e?.message, variant: "destructive" });
    }
    setRenaming(null);
    setFolderName("");
  };

  const retryFolder = async (f) => {
    // Reintenta el procesado de una carpeta que quedó en "failed". Lee el handle
    // guardado en IndexedDB (mismo navegador) y reinicia el procesado en segundo
    // plano. Si el handle ya no existe (otro dispositivo), avisa al usuario.
    try {
      let handle = null;
      if (f.raw_folder_handle_ref) {
        const rec = await getHandleRecord(f.raw_folder_handle_ref);
        if (rec?.handle) handle = rec.handle;
      }
      if (!handle) {
        toast({
          title: "No se puede reintentar automáticamente",
          description: "La carpeta local no está disponible en este dispositivo. Vuelve a seleccionarla con «Añadir carpeta».",
          variant: "destructive",
        });
        return;
      }
      await updateFolder(f.id, { import_status: "processing", last_modified: new Date().toISOString() });
      setFolders((prev) => prev.map((x) => x.id === f.id ? { ...x, import_status: "processing" } : x));
      startProcessing({
        folderHandle: handle,
        files: null,
        folderName: f.raw_folder_name || f.name,
        folderId: f.id,
        projectId: id,
        existing: { folderRef: f.raw_folder_handle_ref },
        onProgress: (job) => {
          setJobProgress((prev) => ({ ...prev, [f.id]: { done: job.progress?.done || 0, total: job.progress?.total || 0, phase: job.phase, status: job.status } }));
        },
        onComplete: (job) => {
          setFolders((prev) => prev.map((x) => x.id === f.id ? { ...x, import_status: "completed", photo_count: job.items?.length || 0 } : x));
          toast({ title: "Carpeta importada", description: `${job.items?.length || 0} fotos procesadas en "${f.name}".` });
        },
        onError: (e) => {
          setFolders((prev) => prev.map((x) => x.id === f.id ? { ...x, import_status: "failed" } : x));
          toast({ title: "Error al importar carpeta", description: e?.message, variant: "destructive" });
        },
      });
    } catch (e) {
      toast({ title: "No se pudo reintentar", description: e?.message, variant: "destructive" });
    }
  };

  const removeFolder = async (f) => {
    if (!window.confirm(`¿Eliminar "${f.name}" del proyecto?\n\nNO se borrarán los archivos físicos. Solo se elimina la carpeta lógica y sus metadatos guardados.`)) return;
    try {
      await deleteFingerprintsByFolder(f.id);
      await deleteFolder(f.id);
      setFolders((prev) => prev.filter((x) => x.id !== f.id));
      toast({ title: "Carpeta eliminada del proyecto" });
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e?.message, variant: "destructive" });
    }
  };

  const moveFolder = async (f, dir) => {
    const sorted = [...folders].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    const idx = sorted.findIndex((x) => x.id === f.id);
    const to = idx + dir;
    if (to < 0 || to >= sorted.length) return;
    const [moved] = sorted.splice(idx, 1);
    sorted.splice(to, 0, moved);
    const reordered = sorted.map((x, i) => ({ ...x, order_index: i }));
    setFolders(reordered);
    await Promise.all(reordered.map((x) => updateFolder(x.id, { order_index: x.order_index }).catch(() => {})));
  };

  const totalPhotos = folders.reduce((s, f) => {
    const jp = jobProgress[f.id];
    if (f.import_status === "processing" && jp?.total) return s + Math.floor(jp.total / 2);
    return s + (f.photo_count || 0);
  }, 0);
  const selCompleted = folders.filter((f) => f.selection_status === "completed").length;
  const editCompleted = folders.filter((f) => f.edit_status === "completed").length;

  const openFolder = (f, mode) => navigate(`/proyectos/nuevo?project=${id}&folder=${f.id}${mode ? `&mode=${mode}` : ""}`);

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando proyecto…</div>;
  }
  if (!project) {
    return <p className="text-sm text-muted-foreground">Proyecto no encontrado.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.event_date || "Sin fecha"}</p>
        </div>
        <Link to="/proyectos" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary">
          <ArrowLeft className="h-3.5 w-3.5" /> Mis proyectos
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Carpetas</p>
            <p className="text-xl font-semibold">{folders.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fotos totales</p>
            <p className="text-xl font-semibold">{totalPhotos.toLocaleString("es")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Selección</p>
            <p className="text-xl font-semibold">{selCompleted}/{folders.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Edición</p>
            <p className="text-xl font-semibold">{editCompleted}/{folders.length}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={addFolder}
          disabled={adding}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-40"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Añadir carpeta
        </button>
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={onFolderPicked} />
        <Link
          to={`/emotive-film?project=${id}`}
          className="ml-auto inline-flex items-center gap-2 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/5"
        >
          <Film className="h-4 w-4" /> Emotive Film IA
        </Link>
      </div>

      {folders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Este proyecto no tiene carpetas. Añade una carpeta para empezar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map((f, i) => (
            <FolderCard
              key={f.id}
              folder={f}
              isFirst={i === 0}
              isLast={i === folders.length - 1}
              renaming={renaming === f.id}
              folderName={folderName}
              onFolderName={setFolderName}
              onRename={() => startRename(f)}
              onConfirmRename={confirmRename}
              onCancelRename={() => { setRenaming(null); setFolderName(""); }}
              onDelete={() => removeFolder(f)}
              onMoveUp={() => moveFolder(f, -1)}
              onMoveDown={() => moveFolder(f, 1)}
              onOpen={() => openFolder(f)}
              onSeleccion={() => openFolder(f, "seleccion")}
              onEdicion={() => openFolder(f, "edicion")}
              onRetry={() => retryFolder(f)}
              progress={jobProgress[f.id]}
              aiProgress={aiProgress[f.id]}
              onCancelSeleccion={() => cancelAiSelection(id, f.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ label, status }) {
  const icons = {
    completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
    processing: <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-500" />,
    in_progress: <CircleDot className="h-3.5 w-3.5 text-yellow-500" />,
    pending: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
    failed: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {icons[status] || icons.pending}
      {label}
    </span>
  );
}

function FolderCard({ folder, isFirst, isLast, renaming, folderName, onFolderName, onRename, onConfirmRename, onCancelRename, onDelete, onMoveUp, onMoveDown, onOpen, onSeleccion, onEdicion, onRetry, progress, aiProgress, onCancelSeleccion }) {
  const isProcessing = folder.import_status === "processing" && progress;
  const detectedCount = isProcessing && progress.total ? Math.floor(progress.total / 2) : 0;
  const pct = isProcessing && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  value={folderName}
                  onChange={(e) => onFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onConfirmRename()}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  autoFocus
                />
                <button onClick={onConfirmRename} className="rounded-md border border-border p-1 hover:bg-secondary"><Check className="h-3.5 w-3.5" /></button>
                <button onClick={onCancelRename} className="rounded-md border border-border p-1 hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <p className="text-sm font-semibold">{folder.name}</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isProcessing && detectedCount > 0
                ? `${detectedCount} fotos detectadas · ${folder.raw_folder_name || ""}`
                : `${folder.photo_count || 0} fotos · ${folder.raw_folder_name || "Sin ruta local"}`}
            </p>
            {isProcessing && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
                    {progress.total
                      ? (progress.phase === "extracting" ? "Leyendo previews" : "Calculando huellas")
                      : "Detectando fotos"}…
                  </span>
                  {progress.total > 0 && (
                    <span className="font-mono font-semibold tabular-nums">
                      {progress.phase === "extracting"
                        ? `${progress.done} / ${detectedCount} fotos`
                        : `${Math.max(0, progress.done - detectedCount)} / ${detectedCount} huellas`}
                    </span>
                  )}
                </div>
                {progress.total > 0 && (
                  <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-yellow-500 transition-all duration-150" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )}
            {aiProgress && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
                    Analizando ráfagas con IA…
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold tabular-nums">
                      {aiProgress.done} / {aiProgress.total}
                    </span>
                    <button
                      onClick={onCancelSeleccion}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/5"
                    >
                      <X className="h-3 w-3" /> Cancelar
                    </button>
                  </div>
                </div>
                <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-yellow-500 transition-all duration-150" style={{ width: `${aiProgress.total ? Math.round((aiProgress.done / aiProgress.total) * 100) : 0}%` }} />
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <StatusBadge label="Importación" status={folder.import_status} />
              <StatusBadge label="Selección" status={aiProgress ? "in_progress" : folder.selection_status} />
              <StatusBadge label="Edición" status={folder.edit_status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={isFirst} title="Subir" className="rounded-md border border-border p-1.5 hover:bg-secondary disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
          <button onClick={onMoveDown} disabled={isLast} title="Bajar" className="rounded-md border border-border p-1.5 hover:bg-secondary disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
          <button onClick={onRename} title="Renombrar" className="rounded-md border border-border p-1.5 hover:bg-secondary"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} title="Eliminar del proyecto" className="rounded-md border border-border p-1.5 hover:bg-secondary hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {folder.import_status === "failed" && (
          <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-yellow-500/50 px-3 py-1.5 text-xs font-medium text-yellow-600 hover:bg-yellow-500/5">
            <RotateCcw className="h-3.5 w-3.5" /> Reintentar
          </button>
        )}
        <button onClick={onOpen} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
          <FolderOpen className="h-3.5 w-3.5" /> Abrir
        </button>
        <button onClick={onSeleccion} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          Selección
        </button>
        <button onClick={onEdicion} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          Edición
        </button>
      </div>
    </div>
  );
}