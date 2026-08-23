import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, Sparkles, Package, Plug, CheckCircle2, ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { analyzePhotometrics } from "@/lib/rawaistudio/photometricAnalysis";
import { computeTechnicalBaseline } from "@/lib/rawaistudio/exposureEngine";
import { defaultParameterConfig, enabledKeys, preferencesFromConfig } from "@/lib/rawaistudio/paramDefs";
import { patchXmpAttributes, addRatingAndLabel, addOrientation } from "@/lib/rawaistudio/xmpTagPatcher";
import { lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { getSession } from "@/lib/rawaistudio/localSession";
import { analyzePhotos } from "@/lib/ai/aiGateway";
import { useToast } from "@/components/ui/use-toast";
import PrecisionModeSelector from "@/components/rawaistudio/PrecisionModeSelector";
import ParameterPanel from "@/components/rawaistudio/ParameterPanel";

// Plantilla XMP mínima cuando no hay preset .xmp: define el namespace crs y deja
// que la IA rellene los básicos. (Mismo contrato que EditorStudio.)
const DEFAULT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"/>
  </rdf:RDF>
</x:xmpmeta>`;

// Ajustes IA — herramienta INDEPENDIENTE. Carga su propia carpeta RAW o usa las fotos
// de la sesión (flujo combinado). Revelado IA con plantilla mínima (sin preset, sin
// selección previa). La IA se invoca EXCLUSIVAMENTE vía aiGateway.analyzePhotos — la
// página no conoce rawAiStudioAnalyze ni InvokeLLM. ZIP siempre; Lightroom solo si las
// fotos provienen de la sesión.
export default function AjustesIA() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = getSession();
  const [photos, setPhotos] = useState([]);
  const [fromSession, setFromSession] = useState(false);
  const [config, setConfig] = useState(defaultParameterConfig());
  const [precisionMode, setPrecisionMode] = useState("balanced");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [zipping, setZipping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extDone, setExtDone] = useState(0);

  const enabledParams = useMemo(() => enabledKeys(config), [config]);
  const preferences = useMemo(() => preferencesFromConfig(config), [config]);

  const useSession = () => {
    if (!session.photos?.length) return;
    setPhotos(
      session.photos.map((p) => ({
        ...p,
        manualRotation: p.manualRotation ?? 0,
        rating: p.rating ?? 0,
        colorLabel: p.colorLabel ?? "none",
      }))
    );
    setFromSession(true);
    setResults([]);
    setSynced(false);
  };

  const onPick = (list) => {
    const raws = Array.from(list || []).filter((f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name));
    if (!raws.length) return;
    setPhotos([]);
    setFromSession(false);
    setResults([]);
    setSynced(false);
    runExtract(raws);
  };

  const runExtract = async (raws) => {
    setExtracting(true);
    setExtDone(0);
    const items = raws.map((f, i) => ({ id: String(i), file: f }));
    const withPreview = await extractPreviews(items, (d) => setExtDone(d));
    setPhotos(withPreview.map((p) => ({ ...p, manualRotation: 0, rating: 0, colorLabel: "none" })));
    setExtracting(false);
  };

  const processAll = async () => {
    if (!photos.length) return;
    setBusy(true);
    setResults([]);
    setSynced(false);
    setProgress({ done: 0, total: photos.length });
    const out = [];
    let ok = 0;
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        const base64 = photo.preview?.base64;
        const stats = base64 ? await analyzePhotometrics(base64) : null;
        const baseline = stats ? computeTechnicalBaseline(stats, precisionMode) : null;
        const data = await analyzePhotos({
          photos: [
            {
              id: photo.id,
              preview_base64: base64,
              baseline: baseline?.values || null,
              technical_confidence: baseline?.confidence ?? null,
              camera: photo.cameraInfo?.brand || null,
            },
          ],
          enabledParams,
          preferences,
          precisionMode,
        });
        const aiValues = data?.results?.[photo.id] || {};
        let xmp = DEFAULT_TEMPLATE;
        xmp = patchXmpAttributes(xmp, aiValues);
        xmp = addRatingAndLabel(xmp, {
          rating: photo.rating || 0,
          label: fromSession ? lightroomLabelFor(photo.colorLabel) : null,
        });
        xmp = addOrientation(xmp, photo.manualRotation || 0);
        out.push({ filename: photo.file.name, xmp });
        ok++;
      } catch {
        // Continúa con la siguiente aunque una falle.
      }
      setProgress({ done: i + 1, total: photos.length });
    }
    setResults(out);
    setBusy(false);
    toast({ title: "Procesamiento completado", description: `${ok} / ${photos.length} XMP listos` });
  };

  const downloadZip = async () => {
    if (!results.length) return;
    setZipping(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", {
        action: "zip-xmp",
        jobs: results.map((r) => ({ filename: r.filename, xmp_content: r.xmp })),
      });
      const url = res?.data?.downloadUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "EditFlowPro-AjustesIA.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      toast({ title: "Error al generar el ZIP", description: e.message, variant: "destructive" });
    }
    setZipping(false);
  };

  const syncToLightroom = async () => {
    if (!results.length) return;
    setSyncing(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", {
        action: "lr-push",
        jobs: results.map((r) => ({ filename: r.filename, xmp_content: r.xmp })),
      });
      setSynced(true);
      toast({ title: "Enviado a Lightroom", description: `${res?.data?.pushed ?? results.length} fotos listas` });
    } catch (e) {
      toast({ title: "Error al sincronizar", description: e.message, variant: "destructive" });
    }
    setSyncing(false);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] rounded-xl bg-[#0a0a0a] p-4 sm:p-6 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500">Ajustes IA</p>
          <h1 className="mt-1 text-2xl font-semibold">Revelado IA independiente</h1>
          <p className="mt-1 text-xs text-zinc-500">
            Plantilla mínima. Sin preset ni selección previa.
            {fromSession ? ` ${photos.length} fotos desde la sesión.` : ""}
          </p>
        </div>
        <button
          onClick={() => navigate("/herramientas")}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Herramientas
        </button>
      </div>

      {photos.length === 0 && !extracting && (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-700 bg-[#141414] p-10 text-center">
          {session.photos?.length ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                Hay {session.photos.length} fotos en la sesión (flujo combinado).
              </p>
              <button
                onClick={useSession}
                className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
              >
                <Sparkles className="h-4 w-4" /> Usar {session.photos.length} fotos de la sesión
              </button>
              <p className="text-xs text-zinc-500">o carga tu propia carpeta:</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
                <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
                <input
                  type="file"
                  className="hidden"
                  webkitdirectory=""
                  directory=""
                  multiple
                  onChange={(e) => onPick(e.target.files)}
                />
              </label>
            </div>
          ) : (
            <div>
              <FolderOpen className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="mt-3 text-sm text-zinc-400">Selecciona la carpeta de RAW</p>
              <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
                <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
                <input
                  type="file"
                  className="hidden"
                  webkitdirectory=""
                  directory=""
                  multiple
                  onChange={(e) => onPick(e.target.files)}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {extracting && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <p className="text-sm font-medium">Leyendo previews embebidas</p>
          <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {extDone} procesadas
          </p>
        </div>
      )}

      {photos.length > 0 && !extracting && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-emerald-400">
              {photos.length} fotos cargadas{fromSession ? " (sesión)" : ""}
            </p>
            <button
              onClick={() => {
                setPhotos([]);
                setResults([]);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Cambiar carpeta
            </button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
            <PrecisionModeSelector value={precisionMode} onChange={setPrecisionMode} />
            <p className="mt-4 text-sm font-medium text-zinc-100">Parámetros de revelado IA</p>
            <p className="mt-1 text-xs text-zinc-500">
              Activa los parámetros que la IA puede tocar. La preferencia es un desplazamiento (0 = sin desplazar).
            </p>
            <ParameterPanel config={config} onChange={setConfig} />
          </div>

          <button
            onClick={processAll}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? `Procesando… ${progress.done} / ${progress.total}` : `Procesar ${photos.length} fotos`}
          </button>

          {results.length > 0 && !busy && (
            <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-5 space-y-4">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-semibold">{results.length} XMP generados. Elige cómo exportarlos:</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={downloadZip}
                  disabled={zipping}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40"
                >
                  {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />} Descargar ZIP completo
                </button>
                {fromSession &&
                  (synced ? (
                    <button
                      onClick={() => navigate("/lightroom")}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      <Plug className="h-4 w-4" /> Ir a Lightroom
                    </button>
                  ) : (
                    <button
                      onClick={syncToLightroom}
                      disabled={syncing}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-40"
                    >
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Sincronizar con Lightroom
                    </button>
                  ))}
              </div>
              {!fromSession && (
                <p className="text-xs text-zinc-500">
                  Lightroom solo está disponible en el flujo combinado (fotos desde la sesión).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}