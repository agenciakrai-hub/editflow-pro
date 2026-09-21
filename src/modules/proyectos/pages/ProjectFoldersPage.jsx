import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, FolderOpen, Plus, Loader2, Trash2, Pencil, ChevronUp, ChevronDown, Check, X, CheckCircle2, Circle, CircleDot, AlertCircle } from "lucide-react";
import { getProject, ensureFoldersMigrated, createFolder, updateFolder, deleteFolder, deleteFingerprintsByFolder } from "../hooks/useProjectStore";
import { startProcessing, getJob, subscribe } from "../lib/backgroundProcessor";
import { saveHandle } from "../lib/idbHandles";
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
        if (job.status === "completed") {
          setFolders((prev) => prev.map((f) => f.id === fid ? { ...f, import_status: "completed", photo_count: job.items?.length || f.photo_count } : f));
        } else if (job.status === "failed") {
          setFolders((prev) => prev.map((f) => f.id === fid ? { ...f, import_status: "failed" } : f));
        }
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [id, processingIds]);

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
        onProgress: () => {},
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

  const totalPhotos = folders.reduce((s, f) => s + (f.photo_count || 0), 0);
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

function FolderCard({ folder, isFirst, isLast, renaming, folderName, onFolderName, onRename, onConfirmRename, onCancelRename, onDelete, onMoveUp, onMoveDown, onOpen, onSeleccion, onEdicion }) {
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
            <p className="mt-0.5 text-xs text-muted-foreground">{folder.photo_count || 0} fotos · {folder.raw_folder_name || "Sin ruta local"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <StatusBadge label="Importación" status={folder.import_status} />
              <StatusBadge label="Selección" status={folder.selection_status} />
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