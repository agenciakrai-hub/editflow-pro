import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, Loader2, Star, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

// Mis Proyectos — lista los proyectos guardados del usuario (solo metadatos, sin previews
// ni RAW). Cada usuario ve únicamente los proyectos que él creó (RLS por created_by_id).
// Los contadores (fotos / seleccionadas / top) se calculan SIEMPRE a partir de los
// ProjectPhotoFingerprint reales — la misma fuente de verdad que usa DetalleProyectoPage —
// nunca del campo legado `photos_metadata` del Project, que el flujo actual no rellena.

const STATUS_STYLE = {
  TOP_PICK: { dot: "bg-amber-400", text: "text-amber-400", label: "Top pick" },
  SELECT: { dot: "bg-emerald-400", text: "text-emerald-400", label: "Seleccionada" },
  REVIEW: { dot: "bg-yellow-500", text: "text-yellow-500", label: "A revisar" },
  REJECT: { dot: "bg-red-500", text: "text-red-400", label: "Descartada" },
};

function statusInfo(s) {
  return STATUS_STYLE[s] || { dot: "bg-zinc-500", text: "text-zinc-400", label: s || "—" };
}

export default function MisProyectos() {
  const { toast } = useToast();
  const [projects, setProjects] = useState(null);
  const [fpByProject, setFpByProject] = useState({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Project.list("-created_date", 50);
      const projectList = Array.isArray(list) ? list : [];
      setProjects(projectList);

      // Una sola consulta para todos los proyectos del usuario (RLS ya restringe a los
      // suyos), agrupada por project_id — evita N consultas y mantiene la misma fuente de
      // verdad que DetalleProyectoPage.
      const fps = await base44.entities.ProjectPhotoFingerprint.list("-created_date", 2000);
      const grouped = {};
      for (const f of Array.isArray(fps) ? fps : []) {
        (grouped[f.project_id] ||= []).push(f);
      }
      setFpByProject(grouped);
    } catch (e) {
      setProjects([]);
      setFpByProject({});
      toast({ title: "No se pudieron cargar los proyectos", description: e?.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggle = (id) => setOpen((p) => ({ ...p, [id]: !p[id] }));

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar este proyecto? Solo se borran los metadatos guardados.")) return;
    setDeleting(id);
    try {
      // Borra en cascada los registros asociados del proyecto antes de eliminarlo, para
      // que no queden huérfanos. Filtra por project_id: solo afecta a este proyecto.
      await base44.entities.ProjectPhotoFingerprint.deleteMany({ project_id: id });
      await base44.entities.CatalogBinding.deleteMany({ project_id: id });
      await base44.entities.Project.delete(id);
      toast({ title: "Proyecto eliminado" });
      load();
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e?.message, variant: "destructive" });
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mis proyectos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Proyectos guardados (solo metadatos). Las imágenes no se almacenan: recarga la carpeta para volver a procesar.
          </p>
        </div>
        <Link to="/proyectos/nuevo" className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          Nuevo proyecto
        </Link>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando proyectos…
        </div>
      )}

      {!loading && projects && projects.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Aún no has guardado ningún proyecto.</p>
          <Link to="/dashboard" className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Ir a selección
          </Link>
        </div>
      )}

      {!loading && projects && projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((p) => {
            const fps = fpByProject[p.id] || [];
            const selCount = fps.filter((f) => f.selection_status === "TOP_PICK" || f.selection_status === "SELECT").length;
            const topCount = fps.filter((f) => f.selection_status === "TOP_PICK").length;
            const isOpen = !!open[p.id];
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <button onClick={() => toggle(p.id)} className="flex items-center gap-2 text-left">
                    {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <div>
                      <p className="text-sm font-semibold">{p.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.event_date || "Sin fecha"} · {fps.length} fotos · {selCount} seleccionadas · {topCount} top
                      </p>
                    </div>
                  </button>
                  <span className="flex items-center gap-2">
                    <Link to={`/dashboard?project=${p.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary">
                      Abrir
                    </Link>
                    <button onClick={() => remove(p.id)} disabled={deleting === p.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-40">
                      {deleting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Eliminar
                    </button>
                  </span>
                </div>
                {isOpen && (
                  <div className="border-t border-border">
                    {fps.length === 0 ? (
                      <p className="p-4 text-xs text-muted-foreground">Sin fotos registradas.</p>
                    ) : (
                      <ul className="divide-y divide-border max-h-80 overflow-auto">
                        {fps.map((f) => {
                          const s = statusInfo(f.selection_status);
                          return (
                            <li key={f.id} className="flex items-center justify-between px-4 py-2 text-sm">
                              <span className="truncate font-mono text-xs text-foreground/80">{f.filename}</span>
                              <span className="flex items-center gap-2">
                                {!!f.rating && (
                                  <span className="flex items-center gap-0.5 text-amber-500">
                                    <Star className="h-3 w-3 fill-amber-500" /> {f.rating}
                                  </span>
                                )}
                                <span className={`flex items-center gap-1.5 text-xs ${s.text}`}>
                                  <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                                  {s.label}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}