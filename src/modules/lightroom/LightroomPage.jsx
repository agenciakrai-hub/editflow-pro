import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Plug, RefreshCw, Loader2, PlugZap, UploadCloud, Copy, CheckCircle2, Clock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { getSession } from "@/lib/rawaistudio/localSession";
import { buildLocalXmp } from "@/modules/local/xmpDownload";

export default function LightroomPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [copied, setCopied] = useState(false);
  const serverUrl = window.location.origin;

  useEffect(() => {
    (async () => {
      const saved = localStorage.getItem("editflow_lr_token");
      if (saved) {
        setToken(saved);
        await refreshStats();
      } else {
        await createToken();
      }
    })();
  }, []);

  const createToken = async () => {
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "lr-token" });
      const t = res.data?.token;
      if (t) {
        localStorage.setItem("editflow_lr_token", t);
        setToken(t);
      }
    } catch (e) {
      toast({ title: "Error al crear token", description: e.message, variant: "destructive" });
    }
  };

  const refreshStats = async () => {
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "lr-stats" });
      setPending(res.data?.pending ?? 0);
      setCompleted(res.data?.completed ?? 0);
    } catch {}
  };

  const downloadPlugin = async () => {
    setDownloading(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "plugin" });
      const url = res.data?.downloadUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "EditFlowPro-plugin.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast({ title: "Plugin descargado", description: "Instálalo en Lightroom Classic" });
      }
    } catch (e) {
      toast({ title: "Error al descargar", description: e.message, variant: "destructive" });
    }
    setDownloading(false);
  };

  const pushToLightroom = async () => {
    const session = getSession();
    const photos = (session.photos || []).filter((p) => p.adjustments && Object.keys(p.adjustments).length);
    if (!photos.length) {
      toast({ title: "Sin fotos editadas", description: "Edita fotos en el Editor IA primero", variant: "destructive" });
      return;
    }
    setPushing(true);
    try {
      const jobs = photos.map((p) => ({ filename: p.name, xmp_content: buildLocalXmp(p.name, p.adjustments) }));
      const res = await base44.functions.invoke("editflow-engine", { action: "lr-push", jobs });
      await refreshStats();
      toast({ title: "XMP enviados a Lightroom", description: `${res.data?.pushed ?? jobs.length} fotos listas para sincronizar` });
    } catch (e) {
      toast({ title: "Error al enviar", description: e.message, variant: "destructive" });
    }
    setPushing(false);
  };

  const copyText = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: `${label} copiado` });
  };

  const stepClass = "flex gap-3 items-start";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Plugin de Lightroom</h1>
      </div>

      {/* Paso 1: descargar e instalar */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Plug className="w-5 h-5 text-accent" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold">1. Descarga e instala el plugin</p>
            <p className="text-xs text-muted-foreground">Plugin nativo para Lightroom Classic (sincroniza por token)</p>
          </div>
        </div>
        <button onClick={downloadPlugin} disabled={downloading} className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Descargar plugin (ZIP)
        </button>
        <div className="text-xs text-muted-foreground space-y-1.5 pt-1">
          <p className={stepClass}><span className="font-semibold text-foreground">•</span> Descomprime el ZIP → carpeta <span className="font-mono">EditFlowPro.lrplugin</span></p>
          <p className={stepClass}><span className="font-semibold text-foreground">•</span> Lightroom → Archivo → Administrador de plugins → Agregar</p>
          <p className={stepClass}><span className="font-semibold text-foreground">•</span> Selecciona la carpeta <span className="font-mono">EditFlowPro.lrplugin</span> → Listo</p>
        </div>
      </div>

      {/* Paso 2: configurar token + URL */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><PlugZap className="w-5 h-5 text-accent" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold">2. Empareja el plugin</p>
            <p className="text-xs text-muted-foreground">Pega estos dos valores en "Configurar (token)" del plugin</p>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium mb-1.5 block text-muted-foreground">URL del servidor</label>
          <div className="flex gap-2">
            <input readOnly value={serverUrl} className="flex-1 bg-secondary rounded-xl px-4 py-3 text-sm font-mono" />
            <button onClick={() => copyText(serverUrl, "URL")} className="px-3 bg-secondary rounded-xl"><Copy className="w-4 h-4" /></button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Token de emparejamiento</label>
          <div className="flex gap-2">
            <input readOnly value={token} className="flex-1 bg-secondary rounded-xl px-4 py-3 text-sm font-mono" />
            <button onClick={() => copyText(token, "Token")} className="px-3 bg-secondary rounded-xl">{copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}</button>
            <button onClick={createToken} className="px-3 bg-secondary rounded-xl"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* Paso 3: enviar XMP y sincronizar */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><UploadCloud className="w-5 h-5 text-accent" /></div>
          <div className="flex-1">
            <p className="text-sm font-semibold">3. Envía los XMP y sincroniza</p>
            <p className="text-xs text-muted-foreground">Sube los ajustes editados a tu cola; luego sincroniza desde Lightroom</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1.5"><Clock className="w-4 h-4 text-muted-foreground" /><p className="text-2xl font-bold">{pending}</p></div>
            <p className="text-xs text-muted-foreground">Pendientes en cola</p>
          </div>
          <div className="bg-secondary rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-600" /><p className="text-2xl font-bold text-green-600">{completed}</p></div>
            <p className="text-xs text-muted-foreground">Sincronizadas</p>
          </div>
        </div>

        <button onClick={pushToLightroom} disabled={pushing} className="flex items-center justify-center gap-2 w-full py-3 bg-accent text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-40">
          {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Enviar a Lightroom
        </button>

        <div className="text-xs text-muted-foreground space-y-1.5">
          <p className={stepClass}><span className="font-semibold text-foreground">•</span> En Lightroom selecciona las fotos (mismo nombre de archivo)</p>
          <p className={stepClass}><span className="font-semibold text-foreground">•</span> Menú: "EditFlow Pro: Sincronizar seleccionadas"</p>
          <p className={stepClass}><span className="font-semibold text-foreground">•</span> El plugin escribe un sidecar .xmp junto a cada foto</p>
        </div>
      </div>
    </div>
  );
}