import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Plug, Sparkles, RefreshCw, Mic, Send, Camera, ChevronDown, ArrowRight, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";

const actions = [
  { icon: Box, title: "Optimizar exportación masiva", desc: "Generar archivos XMP de forma automática", to: "/exportar" },
  { icon: Plug, title: "Sincronizar etiquetas Lightroom", desc: "Asignar 5 estrellas y etiquetas de color", to: "/seleccion" },
  { icon: Sparkles, title: "Visualizar estado procesamiento", desc: "Corregir errores de carga fallida", to: "/admin" },
];

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    base44.entities.Project.list("-updated_date", 10)
      .then(p => { setProjects(p); setSelectedProject(p[0] ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground text-center">o continúa donde lo dejaste</p>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-medium text-muted-foreground shrink-0">Acciones sugeridas para</span>
            <div className="relative">
              <button onClick={() => setDropdownOpen(!dropdownOpen)} className="flex items-center gap-1 px-2 py-1 bg-secondary rounded-md text-sm font-semibold hover:bg-muted transition-colors">
                {selectedProject?.title ?? "Seleccionar"} <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 min-w-48 py-1">
                  {projects.map(p => (
                    <button key={p.id} onClick={() => { setSelectedProject(p); setDropdownOpen(false); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-secondary">
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="p-1.5 hover:bg-secondary rounded-lg">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-2">
          {actions.map((a, i) => (
            <button key={i} onClick={() => navigate(a.to)} className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-secondary transition-colors text-left">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <a.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{a.title}</p>
                <p className="text-xs text-muted-foreground truncate">{a.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3">
          <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2.5 border border-border">
            <input type="text" placeholder="O describe tu propio cambio..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            <button className="p-1 text-muted-foreground"><Mic className="w-4 h-4" /></button>
            <button className="p-1 text-accent"><Send className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">Apps recientes</h2>
          <button onClick={() => navigate("/admin")} className="text-sm text-accent font-medium">Todas las apps</button>
        </div>
        {loading ? (
          <div className="bg-card rounded-2xl border border-border h-24 animate-pulse" />
        ) : projects.length === 0 ? (
          <button onClick={() => navigate("/admin")} className="w-full bg-card rounded-2xl border border-dashed border-border h-32 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground hover:border-accent transition-colors">
            <Plus className="w-5 h-5" /> Crear primer proyecto
          </button>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <button key={p.id} onClick={() => navigate("/seleccion")} className="flex items-center gap-3 w-full bg-card rounded-2xl border border-border p-3 hover:shadow-sm transition-shadow text-left">
                {p.cover_url ? (
                  <Image src={p.cover_url} className="w-14 h-14 rounded-xl" fittingType="fill" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center"><Camera className="w-5 h-5 text-muted-foreground" /></div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.photo_count} fotos · {p.selected_count} seleccionadas</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}