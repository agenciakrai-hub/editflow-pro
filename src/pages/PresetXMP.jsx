import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, FileImage, Loader2, Package, Plug, CheckCircle2, ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { addRatingAndLabel, addOrientation } from "@/lib/rawaistudio/xmpTagPatcher";
import { lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { getSession } from "@/lib/rawaistudio/localSession";
import { useToast } from "@/components/ui/use-toast";

// Preset XMP — herramienta INDEPENDIENTE y 100 % determinista. Carga una carpeta RAW
// (solo nombres) + un preset .xmp y aplica el preset a cada foto como sidecar XMP.
// NO usa InvokeLLM, NO usa UploadFile, NO consume créditos de IA. Reutiliza
// addRatingAndLabel / addOrientation sobre el XML del preset. ZIP siempre; Lightroom
// solo si las fotos provienen de la sesión (flujo combinado).
export default function PresetXMP() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = getSession();
  const [files, setFiles] = useState([]); // RAW File[] (modo propio)
  const [photos, setPhotos] = useState([]); // fotos de sesión (modo combinado)
  const [fromSession, setFromSession] = useState(false);
  const [presetText, setPresetText] = useState("");
  const [presetName, setPresetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [zipping, setZipping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  const useSession = () => {
    if (!session.photos?.length) return;
    setPhotos(session.photos);
    setFiles([]);
    setFromSession(true);
    setResults([]);
    setSynced(false);
  };

  const onPickRaw = (list) => {
    const raws = Array.from(list || []).filter((f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name));
    if (!raws.length) return;
    setFiles(raws);
    setPhotos([]);
    setFromSession(false);
    setResults([]);
    setSynced(false);
  };

  const onPickPreset = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      setPresetText(text);
      setPresetName(file.name);
    } catch (e) {
      toast({ title: "No se pudo leer el preset", description: e.message, variant: "destructive" });
    }
  };

  const targets = fromSession ? photos : files;
  const canProcess = targets.length > 0 && !!presetText;

  const processAll = () => {
    if (!canProcess) return;
    setBusy(true);
    setResults([]);
    setSynced(false);
    const out = targets.map((item) => {
      const name = fromSession ? item.file.name : item.name;
      const rating = fromSession ? item.rating || 0 : 0;
      const colorLabel = fromSession ? item.colorLabel || "none" : "none";
      let xmp = presetText;
      xmp = addRatingAndLabel(xmp, {
        rating,
        label: fromSession && colorLabel !== "none" ? lightroomLabelFor(colorLabel) : null,
      });
      xmp = addOrientation(xmp, fromSession ? item.manualRotation || 0 : 0);
      return { filename: name, xmp };
    });
    setResults(out);
    setBusy(false);
    toast({ title: "Preset aplicado", description: `${out.length} XMP generados (determinista)` });
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
        a.download = "EditFlowPro-PresetXMP.zip";
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
          <p className="text-sm text-zinc-500">Preset XMP</p>
          <h1 className="mt-1 text-2xl font-semibold">Aplicar preset de forma determinista</h1>
          <p className="mt-1 text-xs text-zinc-500">
            Carga RAW + preset .xmp. Sin IA, sin créditos.
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

      <div className="mt-6 grid grid-cols-1 gap-4">
        {/* Origen de fotos */}
        <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <p className="text-sm font-medium text-zinc-100">1. Fotos</p>
          {targets.length === 0 ? (
            <div className="mt-3 space-y-3">
              {session.photos?.length ? (
                <button
                  onClick={useSession}
                  className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
                >
                  <FileImage className="h-4 w-4" /> Usar {session.photos.length} fotos de la sesión
                </button>
              ) : null}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
                <FolderOpen className="h-4 w-4" /> Seleccionar carpeta RAW
                <input
                  type="file"
                  className="hidden"
                  webkitdirectory=""
                  directory=""
                  multiple
                  onChange={(e) => onPickRaw(e.target.files)}
                />
              </label>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-emerald-400">
                {targets.length} fotos{fromSession ? " (sesión)" : ""}
              </p>
              <button
                onClick={() => {
                  setFiles([]);
                  setPhotos([]);
                  setFromSession(false);
                  setResults([]);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Cambiar
              </button>
            </div>
          )}
        </div>

        {/* Preset */}
        <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <p className="text-sm font-medium text-zinc-100">2. Preset .xmp</p>
          <div className="mt-3 flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
              <FileImage className="h-4 w-4" /> Cargar preset
              <input
                type="file"
                accept=".xmp"
                className="hidden"
                onChange={(e) => onPickPreset(e.target.files?.[0])}
              />
            </label>
            {presetName && <span className="text-xs text-emerald-400">{presetName}</span>}
          </div>
        </div>

        {/* Procesar */}
        <button
          onClick={processAll}
          disabled={!canProcess || busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
          {busy ? "Aplicando…" : `Aplicar preset a ${targets.length} fotos`}
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
    </div>
  );
}