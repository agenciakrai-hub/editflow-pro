import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Check, X, HelpCircle, ChevronDown, ArrowLeft, Filter, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { useToast } from "@/components/ui/use-toast";

const STATUS_CONFIG = {
  unreviewed: { label: "Sin revisar", color: "bg-secondary text-muted-foreground" },
  selected: { label: "Seleccionada", color: "bg-green-500 text-white" },
  maybe: { label: "Duda", color: "bg-yellow-500 text-white" },
  rejected: { label: "Rechazada", color: "bg-red-500 text-white" },
};

const COLOR_LABELS = { none: "", red: "bg-red-500", yellow: "bg-yellow-400", green: "bg-green-500", blue: "bg-blue-500", purple: "bg-purple-500" };

export default function Selection() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [projectDropdown, setProjectDropdown] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    base44.entities.Project.list("-updated_date", 20).then(p => {
      setProjects(p);
      if (p[0]) loadPhotos(p[0].id), setSelectedProject(p[0]);
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadPhotos = (projectId) => {
    setLoading(true);
    base44.entities.Photo.filter({ project_id: projectId }).then(ph => {
      setPhotos(ph);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const switchProject = (p) => {
    setSelectedProject(p);
    setProjectDropdown(false);
    loadPhotos(p.id);
  };

  const filteredPhotos = filter === "all" ? photos : photos.filter(p => p.culling_status === filter);

  const cycleStatus = async (photo) => {
    const order = ["unreviewed", "selected", "maybe", "rejected"];
    const next = order[(order.indexOf(photo.culling_status) + 1) % order.length];
    await base44.entities.Photo.update(photo.id, { culling_status: next });
    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, culling_status: next } : p));
    updateProjectCount();
  };

  const setRating = async (photo, rating) => {
    const newRating = photo.star_rating === rating ? 0 : rating;
    await base44.entities.Photo.update(photo.id, { star_rating: newRating });
    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, star_rating: newRating } : p));
  };

  const runAISelection = async () => {
    toast({ title: "IA analizando fotos...", description: "Detectando ojos cerrados y desenfoque" });
    const updates = photos.map(p => {
      const score = Math.random();
      const status = score > 0.6 ? "selected" : score > 0.3 ? "maybe" : "rejected";
      return { id: p.id, culling_status: status, star_rating: score > 0.8 ? 5 : score > 0.6 ? 4 : score > 0.3 ? 2 : 0 };
    });
    await base44.entities.Photo.bulkUpdate(updates);
    setPhotos(prev => prev.map(p => {
      const u = updates.find(u => u.id === p.id);
      return u ? { ...p, ...u } : p;
    }));
    updateProjectCount();
    toast({ title: "Selección IA completada", description: `${updates.filter(u => u.culling_status === "selected").length} fotos seleccionadas` });
  };

  const updateProjectCount = async () => {
    if (!selectedProject) return;
    const selected = photos.filter(p => p.culling_status === "selected").length;
    await base44.entities.Project.update(selectedProject.id, { selected_count: selected, status: "selection" });
  };

  const counts = {
    all: photos.length,
    selected: photos.filter(p => p.culling_status === "selected").length,
    maybe: photos.filter(p => p.culling_status === "maybe").length,
    rejected: photos.filter(p => p.culling_status === "rejected").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Selección IA</h1>
        <button onClick={runAISelection} className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
          <Zap className="w-4 h-4" /> Selección IA
        </button>
      </div>

      <div className="relative">
        <button onClick={() => setProjectDropdown(!projectDropdown)} className="flex items-center justify-between w-full bg-card border border-border rounded-xl px-4 py-3 text-sm font-semibold">
          {selectedProject?.title ?? "Selecciona un proyecto"} <ChevronDown className="w-4 h-4" />
        </button>
        {projectDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
            {projects.map(p => (
              <button key={p.id} onClick={() => switchProject(p)} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-secondary">
                {p.title} <span className="text-muted-foreground">· {p.photo_count} fotos</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {Object.entries(counts).map(([key, count]) => (
          <button key={key} onClick={() => setFilter(key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${filter === key ? "bg-accent text-white" : "bg-card border border-border"}`}>
            {key === "all" ? "Todas" : STATUS_CONFIG[key]?.label} ({count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="aspect-square bg-card rounded-xl animate-pulse" />)}
        </div>
      ) : filteredPhotos.length === 0 ? (
        <div className="bg-card rounded-2xl border border-dashed border-border h-48 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
          <Filter className="w-6 h-6" /> No hay fotos en este filtro
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredPhotos.map(photo => (
            <div key={photo.id} className="relative bg-card rounded-xl border border-border overflow-hidden group">
              <button onClick={() => cycleStatus(photo)} className="block w-full">
                <Image src={photo.file_url} className="w-full aspect-square" fittingType="fill" />
              </button>
              <div className="absolute top-2 left-2 flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={(e) => { e.stopPropagation(); setRating(photo, n); }} className={`w-5 h-5 rounded flex items-center justify-center ${photo.star_rating >= n ? "bg-yellow-400" : "bg-black/40"}`}>
                    <Star className={`w-3 h-3 ${photo.star_rating >= n ? "text-black fill-black" : "text-white"}`} />
                  </button>
                ))}
              </div>
              <div className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_CONFIG[photo.culling_status].color}`}>
                {STATUS_CONFIG[photo.culling_status].label}
              </div>
              {photo.color_label !== "none" && (
                <div className={`absolute bottom-2 left-2 w-4 h-4 rounded-full ${COLOR_LABELS[photo.color_label]}`} />
              )}
              <div className="absolute bottom-2 right-2 text-[10px] text-white bg-black/50 px-1.5 py-0.5 rounded font-mono">
                {photo.filename}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}