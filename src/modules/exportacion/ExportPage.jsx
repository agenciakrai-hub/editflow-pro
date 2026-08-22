import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileDown, ChevronDown, Loader2, Check, Code } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function ExportPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dropdown, setDropdown] = useState(false);
  const [scope, setScope] = useState("edited");

  useEffect(() => {
    base44.entities.Project.list("-updated_date", 20).then((p) => {
      setProjects(p);
      if (p[0]) { setSelectedProject(p[0]); loadPhotos(p[0].id); }
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadPhotos = (projectId) => {
    setLoading(true);
    base44.entities.Photo.filter({ project_id: projectId }).then((ph) => { setPhotos(ph); setLoading(false); }).catch(() => setLoading(false));
  };

  const editedCount = photos.filter((p) => p.edit_applied).length;
  const selectedCount = photos.filter((p) => p.culling_status === "selected").length;
  const targetCount = scope === "edited" ? editedCount : selectedCount;

  const handleExport = async () => {
    if (!selectedProject) return;
    setExporting(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", {
        action: "export",
        projectId: selectedProject.id,
        projectTitle: selectedProject.title,
        scope,
      });
      setResult(res.data);
      toast({ title: "Exportación completada", description: `${res.data.count} archivos XMP` });
    } catch (e) {
      toast({ title: "Error de exportación", description: e.message, variant: "destructive" });
    }
    setExporting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Exportación XMP</h1>
      </div>

      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Proyecto</label>
          <div className="relative">
            <button onClick={() => setDropdown(!dropdown)} className="flex items-center justify-between w-full bg-secondary rounded-xl px-4 py-3 text-sm font-medium">
              {selectedProject?.title ?? "Selecciona un proyecto"} <ChevronDown className="w-4 h-4" />
            </button>
            {dropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { setSelectedProject(p); loadPhotos(p.id); setResult(null); setDropdown(false); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-secondary">{p.title}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Qué exportar</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setScope("edited")} className={`p-3 rounded-xl border text-sm font-medium transition-colors ${scope === "edited" ? "border-accent bg-accent/5" : "border-border bg-secondary"}`}>
              <div className="font-semibold">Editadas</div><div className="text-xs text-muted-foreground">{editedCount} fotos</div>
            </button>
            <button onClick={() => setScope("selected")} className={`p-3 rounded-xl border text-sm font-medium transition-colors ${scope === "selected" ? "border-accent bg-accent/5" : "border-border bg-secondary"}`}>
              <div className="font-semibold">Seleccionadas</div><div className="text-xs text-muted-foreground">{selectedCount} fotos</div>
            </button>
          </div>
        </div>

        <div className="bg-secondary rounded-xl p-3 flex items-center gap-3">
          <FileDown className="w-5 h-5 text-accent" />
          <div className="flex-1"><p className="text-sm font-medium">Formato XMP</p><p className="text-xs text-muted-foreground">ZIP con sidecars + LEEME.txt</p></div>
          <span className="text-sm font-bold">{targetCount}</span>
        </div>

        <button onClick={handleExport} disabled={!selectedProject || targetCount === 0 || exporting} className="w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2">
          {exporting ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando…</> : <><Download className="w-4 h-4" /> Generar y descargar XMP</>}
        </button>
      </div>

      {result && (
        <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
          <div className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" /><span className="font-semibold text-sm">{result.count} archivos XMP generados</span></div>
          {result.downloadUrl && <a href={result.downloadUrl} download={`${selectedProject.title}_xmp.zip`} className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90"><Download className="w-4 h-4" /> Descargar ZIP</a>}
          <div>
            <div className="flex items-center gap-1.5 mb-2"><Code className="w-4 h-4" /><span className="text-xs font-semibold">Vista previa XMP</span></div>
            <pre className="bg-background border border-border rounded-xl p-3 text-[10px] font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">{result.preview}</pre>
          </div>
        </div>
      )}

      {loading && <div className="bg-card rounded-2xl border border-border h-32 animate-pulse" />}
    </div>
  );
}