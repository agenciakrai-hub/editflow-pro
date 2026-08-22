import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileDown, Check, ChevronDown, Loader2, Code } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { useToast } from "@/components/ui/use-toast";

function generateXMP(adjustments, filename) {
  const a = adjustments || {};
  const crs = [
    `crs:Exposure2012="${a.exposure ?? 0}"`,
    `crs:Contrast2012="${a.contrast ?? 0}"`,
    `crs:Highlights2012="${a.highlights ?? 0}"`,
    `crs:Shadows2012="${a.shadows ?? 0}"`,
    `crs:Whites2012="${a.whites ?? 0}"`,
    `crs:Blacks2012="${a.blacks ?? 0}"`,
    `crs:Temperature="${a.temperature ?? 0}"`,
    `crs:Tint="${a.tint ?? 0}"`,
    `crs:Vibrance="${a.vibrance ?? 0}"`,
    `crs:Saturation="${a.saturation ?? 0}"`,
    `crs:Clarity2012="${a.clarity ?? 0}"`,
    `crs:Sharpness="${a.sharpness ?? 0}"`,
  ].join("\n      ");
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="${filename}"
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      ${crs}
    />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export default function ExportPage() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [editedPhotos, setEditedPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [projectDropdown, setProjectDropdown] = useState(false);
  const [scope, setScope] = useState("edited");
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    base44.entities.Project.list("-updated_date", 20).then(p => {
      setProjects(p);
      if (p[0]) { setSelectedProject(p[0]); loadPhotos(p[0].id); }
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadPhotos = (projectId) => {
    setLoading(true);
    base44.entities.Photo.filter({ project_id: projectId }).then(ph => {
      setPhotos(ph);
      setEditedPhotos(ph.filter(p => p.edit_applied));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const switchProject = (p) => { setSelectedProject(p); setProjectDropdown(false); loadPhotos(p.id); setExportResult(null); };

  const handleExport = async () => {
    if (!selectedProject) return;
    setExporting(true);
    const target = scope === "edited" ? editedPhotos : photos.filter(p => p.culling_status === "selected");
    const xmpBundle = target.map(ph => ({ filename: ph.filename, content: generateXMP(ph.adjustments, ph.filename) }));
    const preview = xmpBundle.slice(0, 2).map(x => `<!-- ${x.filename} -->\n${x.content}`).join("\n\n");
    const fullBundle = xmpBundle.map(x => `<!-- ${x.filename} -->\n${x.content}`).join("\n\n");

    const job = await base44.entities.ExportJob.create({
      project_id: selectedProject.id,
      project_title: selectedProject.title,
      status: "completed",
      photo_count: target.length,
      format: "xmp",
      xmp_preview: preview,
    });

    const blob = new Blob([fullBundle], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    setExportResult({ count: target.length, downloadUrl: url, preview, jobId: job.id });
    setExporting(false);
    toast({ title: "Exportación completada", description: `${target.length} archivos XMP generados` });
  };

  const targetCount = scope === "edited" ? editedPhotos.length : photos.filter(p => p.culling_status === "selected").length;

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
            <button onClick={() => setProjectDropdown(!projectDropdown)} className="flex items-center justify-between w-full bg-secondary rounded-xl px-4 py-3 text-sm font-medium">
              {selectedProject?.title ?? "Selecciona un proyecto"} <ChevronDown className="w-4 h-4" />
            </button>
            {projectDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
                {projects.map(p => (
                  <button key={p.id} onClick={() => switchProject(p)} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-secondary">{p.title}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Qué exportar</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setScope("edited")} className={`p-3 rounded-xl border text-sm font-medium transition-colors ${scope === "edited" ? "border-accent bg-accent/5" : "border-border bg-secondary"}`}>
              <div className="font-semibold">Editadas</div>
              <div className="text-xs text-muted-foreground">{editedPhotos.length} fotos</div>
            </button>
            <button onClick={() => setScope("selected")} className={`p-3 rounded-xl border text-sm font-medium transition-colors ${scope === "selected" ? "border-accent bg-accent/5" : "border-border bg-secondary"}`}>
              <div className="font-semibold">Seleccionadas</div>
              <div className="text-xs text-muted-foreground">{photos.filter(p => p.culling_status === "selected").length} fotos</div>
            </button>
          </div>
        </div>

        <div className="bg-secondary rounded-xl p-3 flex items-center gap-3">
          <FileDown className="w-5 h-5 text-accent" />
          <div className="flex-1">
            <p className="text-sm font-medium">Formato XMP</p>
            <p className="text-xs text-muted-foreground">Compatible con Lightroom Classic</p>
          </div>
          <span className="text-sm font-bold">{targetCount}</span>
        </div>

        <button onClick={handleExport} disabled={!selectedProject || targetCount === 0 || exporting} className="w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2">
          {exporting ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</> : <><Download className="w-4 h-4" /> Generar y descargar XMP</>}
        </button>
      </div>

      {exportResult && (
        <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
          <div className="flex items-center gap-2 text-green-600">
            <Check className="w-5 h-5" />
            <span className="font-semibold text-sm">{exportResult.count} archivos XMP generados</span>
          </div>
          <a href={exportResult.downloadUrl} download={`${selectedProject.title}_xmp_bundle.xmp`} className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">
            <Download className="w-4 h-4" /> Descargar bundle XMP
          </a>
          <div>
            <div className="flex items-center gap-1.5 mb-2"><Code className="w-4 h-4" /><span className="text-xs font-semibold">Vista previa XMP</span></div>
            <pre className="bg-background border border-border rounded-xl p-3 text-[10px] font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">{exportResult.preview}</pre>
          </div>
        </div>
      )}

      {loading && <div className="bg-card rounded-2xl border border-border h-32 animate-pulse" />}
    </div>
  );
}