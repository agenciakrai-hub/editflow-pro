import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, FilePlus2, Loader2, Trash2, Upload } from "lucide-react";
import AlbumCreateForm from "@/modules/album/components/AlbumCreateForm";
import { listAlbums, createAlbum, deleteAlbum } from "@/modules/album/hooks/useAlbumProject";
import { openAlbumFile, importOpenedAlbumFile } from "@/modules/album/format/albumFileIO";
import { deleteProjectData } from "@/modules/album/lib/previewStore";
import { albumSizeLabel, STATUS_LABEL, EVENT_LABEL } from "@/modules/album/lib/albumUnits";
import { useToast } from "@/components/ui/use-toast";

// Lista de álbumes + creación + importación de .editflowalbum (wireframe B de Fase 1).
export default function AlbumsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [albums, setAlbums] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const load = async () => setAlbums(await listAlbums());

  useEffect(() => {
    load().catch((e) => toast({ title: "No se pudo cargar", description: e?.message, variant: "destructive" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (data) => {
    setCreating(true);
    try {
      const p = await createAlbum(data);
      navigate(`/album?project=${p.id}`);
    } catch (e) {
      toast({ title: "No se pudo crear el álbum", description: e?.message, variant: "destructive" });
    }
    setCreating(false);
  };

  const handleDelete = async (a) => {
    if (!window.confirm(`¿Eliminar el álbum "${a.name}"? Se borrarán sus spreads y su catálogo de fotos (no los archivos originales).`)) return;
    try {
      await deleteAlbum(a.id);
      await deleteProjectData(a.id);
      await load();
      toast({ title: "Álbum eliminado" });
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e?.message, variant: "destructive" });
    }
  };

  // Fase C — apertura directa del archivo del álbum: validar, importar como álbum
  // NUEVO y entrar directamente en el editor. El handle del archivo queda VINCULADO:
  // ⌘+S guardará sobre ese mismo archivo. Compatible v1/v2 (lo garantiza el parser).
  const openImportedFile = async (file, handle = null) => {
    setOpeningFile(true);
    try {
      const p = await importOpenedAlbumFile(file, handle);
      toast({ title: "Álbum abierto", description: "Re-importa la carpeta de fotos para recuperar las previews. ⌘+S guardará en este archivo." });
      navigate(`/album?project=${p.id}`);
    } catch (err) {
      toast({ title: "Archivo inválido", description: err?.message, variant: "destructive" });
    } finally {
      setOpeningFile(false);
    }
  };

  const handleOpenFile = async () => {
    if (openingFile) return;
    const res = await openAlbumFile();
    if (res?.canceled || !res?.file) return;
    await openImportedFile(res.file, res.handle || null);
  };

  const handleDropFile = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && String(f.name).toLowerCase().endsWith(".editflowalbum")) await openImportedFile(f, null);
  };

  const btn = "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary";

  return (
    <div
      className={"space-y-5 rounded-xl " + (dragOver ? "border-2 border-dashed border-primary bg-primary/5" : "")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={handleDropFile}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Album AI</p>
          <h1 className="text-2xl font-semibold">Mis álbumes</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Importa tu carpeta de fotos finales exportadas desde Lightroom y maqueta el álbum lienzo a lienzo. Las fotos originales nunca se modifican.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className={btn} onClick={handleOpenFile} disabled={openingFile} title="Abrir un archivo .editflowalbum (también puedes arrastrarlo aquí)">
            {openingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {openingFile ? "Abriendo…" : "Abrir .editflowalbum"}
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90" onClick={() => setShowForm((v) => !v)}>
            <FilePlus2 className="h-4 w-4" /> Nuevo álbum
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <AlbumCreateForm creating={creating} onCreate={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {albums === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando álbumes…</div>
      ) : albums.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Todavía no hay álbumes. Crea el primero para empezar a maquetar.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <div key={a.id} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="font-semibold">{a.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {albumSizeLabel(a)} · {EVENT_LABEL[a.event_type] || a.event_type}
              </p>
              <p className="mt-2 text-xs">
                <span className="rounded-full bg-secondary px-2.5 py-1 font-medium">{STATUS_LABEL[a.status] || a.status}</span>
              </p>
              {a.updated_date && <p className="mt-2 text-[11px] text-muted-foreground">Actualizado el {new Date(a.updated_date).toLocaleDateString()}</p>}
              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <button className="inline-flex flex-1 items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  onClick={() => navigate(`/album?project=${a.id}`)}>
                  Abrir
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(a)}>
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}