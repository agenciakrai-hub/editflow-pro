import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FolderOpen, Image as ImageIcon, Palette, Download, Plus, Users, TrendingUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";

export default function Admin() {
  const [projects, setProjects] = useState([]);
  const [presets, setPresets] = useState([]);
  const [exportJobs, setExportJobs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      base44.entities.Project.list("-updated_date", 50),
      base44.entities.Preset.list("-updated_date", 50),
      base44.entities.ExportJob.list("-updated_date", 10),
      base44.entities.User.list().catch(() => []),
    ]).then(([p, pr, ej, u]) => {
      setProjects(p); setPresets(pr); setExportJobs(ej); setUsers(u); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const createProject = async () => {
    if (!newTitle.trim()) return;
    const p = await base44.entities.Project.create({ title: newTitle, status: "draft", photo_count: 0, selected_count: 0 });
    setProjects(prev => [p, ...prev]);
    setNewTitle(""); setShowNewProject(false);
  };

  const stats = [
    { label: "Proyectos", value: projects.length, icon: FolderOpen, color: "text-blue-500" },
    { label: "Fotos", value: projects.reduce((s, p) => s + (p.photo_count || 0), 0), icon: ImageIcon, color: "text-accent" },
    { label: "Presets", value: presets.length, icon: Palette, color: "text-purple-500" },
    { label: "Exportaciones", value: exportJobs.length, icon: Download, color: "text-green-500" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Administración</h1>
        <button onClick={() => setShowNewProject(!showNewProject)} className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90">
          <Plus className="w-4 h-4" /> Nuevo
        </button>
      </div>

      {showNewProject && (
        <div className="bg-card rounded-2xl border border-border p-4 flex gap-2">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Nombre del proyecto..." className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none" onKeyDown={e => e.key === "Enter" && createProject()} />
          <button onClick={createProject} className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold">Crear</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {stats.map((s, i) => (
          <div key={i} className="bg-card rounded-2xl border border-border p-4">
            <div className={`w-9 h-9 rounded-lg bg-secondary flex items-center justify-center mb-2`}>
              <s.icon className={`w-4 h-4 ${s.color}`} />
            </div>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-bold mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Proyectos</h2>
        {loading ? (
          <div className="bg-card rounded-2xl border border-border h-32 animate-pulse" />
        ) : projects.length === 0 ? (
          <div className="bg-card rounded-2xl border border-dashed border-border h-24 flex items-center justify-center text-sm text-muted-foreground">Sin proyectos</div>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <div key={p.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
                {p.cover_url ? <Image src={p.cover_url} className="w-12 h-12 rounded-lg" fittingType="fill" /> : <div className="w-12 h-12 rounded-lg bg-secondary" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.photo_count} fotos · {p.selected_count} sel.</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${p.status === "completed" ? "bg-green-500/15 text-green-600" : p.status === "editing" ? "bg-blue-500/15 text-blue-600" : "bg-secondary text-muted-foreground"}`}>{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {exportJobs.length > 0 && (
        <div>
          <h2 className="text-sm font-bold mb-2">Exportaciones recientes</h2>
          <div className="space-y-2">
            {exportJobs.map(j => (
              <div key={j.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
                <Download className="w-4 h-4 text-accent" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{j.project_title}</p>
                  <p className="text-xs text-muted-foreground">{j.photo_count} archivos · {j.format.toUpperCase()}</p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-green-500/15 text-green-600">{j.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {users.length > 0 && (
        <div>
          <h2 className="text-sm font-bold mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Usuarios</h2>
          <div className="bg-card rounded-2xl border border-border divide-y divide-border">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold">
                  {u.email?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.email}</p>
                  <p className="text-xs text-muted-foreground">{u.role}</p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-secondary">{u.plan ?? "none"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}