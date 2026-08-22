import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Plug, RefreshCw, Loader2, PlugZap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function LightroomPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dropdown, setDropdown] = useState(false);

  useEffect(() => {
    base44.entities.Project.list("-updated_date", 20).then((p) => {
      setProjects(p);
      if (p[0]) { setSelectedProject(p[0]); refreshStats(p[0].id); }
    }).catch(() => {});
    setToken(generateToken());
  }, []);

  const refreshStats = async (projectId) => {
    const ph = await base44.entities.Photo.filter({ project_id: projectId });
    setPending(ph.filter((p) => p.edit_applied && p.export_status !== "exported").length);
    setCompleted(ph.filter((p) => p.export_status === "exported").length);
  };

  const downloadPlugin = async () => {
    setDownloading(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "plugin" });
      if (res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, "_blank");
        toast({ title: "Plugin de Lightroom descargado", description: "Instálalo en Lightroom Classic" });
      }
    } catch (e) {
      toast({ title: "Error al descargar el plugin", description: e.message, variant: "destructive" });
    }
    setDownloading(false);
  };

  const sync = async () => {
    if (!selectedProject) return;
    setSyncing(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "sync", projectId: selectedProject.id, token });
      setPending(res.data?.pending ?? 0);
      setCompleted(res.data?.completed ?? 0);
      toast({ title: "Sincronización actualizada", description: `${res.data?.completed ?? completed} fotos sincronizadas` });
    } catch (e) {
      toast({ title: "Error de sincronización", description: e.message, variant: "destructive" });
    }
    setSyncing(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Plugin de Lightroom</h1>
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Plug className="w-5 h-5 text-accent" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Conexión con Lightroom Classic</p>
            <p className="text-xs text-muted-foreground">Descarga el plugin, instálalo y conecta con tu token</p>
          </div>
        </div>
        <button onClick={downloadPlugin} disabled={downloading} className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Descargar plugin (ZIP)
        </button>
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Proyecto</label>
          <div className="relative">
            <button onClick={() => setDropdown(!dropdown)} className="flex items-center justify-between w-full bg-secondary rounded-xl px-4 py-3 text-sm font-medium">
              {selectedProject?.title ?? "Selecciona un proyecto"} <ArrowLeft className="w-4 h-4 rotate-90" />
            </button>
            {dropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { setSelectedProject(p); refreshStats(p.id); setDropdown(false); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-secondary">{p.title}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Token de conexión</label>
          <div className="flex gap-2">
            <input value={token} onChange={(e) => setToken(e.target.value)} className="flex-1 bg-secondary rounded-xl px-4 py-3 text-sm font-mono" placeholder="Token" />
            <button onClick={() => setToken(generateToken())} className="px-3 py-3 bg-secondary rounded-xl"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary rounded-xl p-3 text-center"><p className="text-2xl font-bold">{pending}</p><p className="text-xs text-muted-foreground">Pendientes</p></div>
          <div className="bg-secondary rounded-xl p-3 text-center"><p className="text-2xl font-bold text-green-600">{completed}</p><p className="text-xs text-muted-foreground">Sincronizadas</p></div>
        </div>

        <button onClick={sync} disabled={!selectedProject || syncing} className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Sincronizar con Lightroom
        </button>
      </div>
    </div>
  );
}

function generateToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}