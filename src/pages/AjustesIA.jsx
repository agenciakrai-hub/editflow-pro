import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, Sparkles, Package, Plug, CheckCircle2, ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { analyzePhotometrics } from "@/lib/rawaistudio/photometricAnalysis";
import { computeAutoBasicsPro } from "@/lib/rawaistudio/autoBasicsEngine";
import { defaultParameterConfig, enabledKeys, preferencesFromConfig } from "@/lib/rawaistudio/paramDefs";
import { patchXmpAttributes, addRatingAndLabel, addOrientation } from "@/lib/rawaistudio/xmpTagPatcher";
import { lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { getSession } from "@/lib/rawaistudio/localSession";
import { developPhotosVisual, generateSessionProfile } from "@/lib/ai/aiGateway";
import { pickRepresentatives, adaptPhotoWithProfile } from "@/lib/rawaistudio/hybridAdaptEngine";
import { useToast } from "@/components/ui/use-toast";
import PrecisionModeSelector from "@/components/rawaistudio/PrecisionModeSelector";
import ParameterPanel from "@/components/rawaistudio/ParameterPanel";
import PresetLoadSection from "@/components/rawaistudio/PresetLoadSection";

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
  const [mode, setMode] = useState("free"); // "free" (GRATIS, determinista) | "qwen" (IA)
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [zipping, setZipping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [presetTemplateText, setPresetTemplateText] = useState("");
  const [presetFile, setPresetFile] = useState(null);
  const [profile, setProfile] = useState(null);
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

    // Revelado Híbrido: 1 llamada IA con K fotos representativas → perfil de sesión.
    // El motor local (adaptPhotoWithProfile) aplica y adapta ese perfil a cada foto.
    let sessionProfile = null;
    if (mode === "hybrid") {
      try {
        const reps = pickRepresentatives(photos, 8);
        const repData = reps
          .filter((p) => p.preview?.base64)
          .map((p) => ({ id: p.id, preview_base64: p.preview.base64 }));
        if (!repData.length) {
          toast({ title: "Sin previews", description: "No hay previews para analizar", variant: "destructive" });
          setBusy(false);
          return;
        }
        const data = await generateSessionProfile({ representatives: repData, preferences });
        sessionProfile = data?.profile || null;
        setProfile(sessionProfile);
      } catch (e) {
        toast({ title: "Error al generar el perfil", description: e.message, variant: "destructive" });
        setBusy(false);
        return;
      }
    } else {
      setProfile(null);
    }

    const out = [];
    let ok = 0;
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        const base64 = photo.preview?.base64;
        const stats = base64 ? await analyzePhotometrics(base64) : null;
        let aiValues = {};
        let needsCorrection = false;
        let allZero = false;
        if (mode === "free") {
          // Auto Ajustes Básicos Pro — GRATIS: 100% determinista, cero llamadas IA/red.
          // Analiza histograma (RGB por canal + luminancia), clipping de altas luces y
          // sombras, distribución tonal y contraste global. Devuelve siempre los 6
          // parámetros de revelado básico.
          const pro = stats ? computeAutoBasicsPro(stats, precisionMode) : null;
          aiValues = pro?.values || {};
          needsCorrection = !!pro?.needsCorrection;
          allZero = !!pro?.allZero;
        } else if (mode === "hybrid") {
          // Perfil de sesión (IA, 1 llamada) + adaptación fotométrica local por foto.
          aiValues = adaptPhotoWithProfile(stats, sessionProfile, precisionMode, preferences, enabledParams);
          needsCorrection = Object.values(aiValues).some((v) => v);
          allZero = !needsCorrection;
        } else {
          // Revelado IA Visual (Qwen): la IA analiza el CONTENIDO de cada foto (sujeto,
          // luz, color, mood) y decide los ajustes de revelado completos, no solo el
          // histograma. Sin baseline técnico. Se filtra a los parámetros activados.
          const data = await developPhotosVisual({
            photos: [{ id: photo.id, preview_base64: base64 }],
            preferences,
          });
          const all = data?.results?.[photo.id] || {};
          aiValues = {};
          for (const k of enabledParams) if (typeof all[k] === "number") aiValues[k] = all[k];
        }
        // GRATIS: el preset (.xmp) aporta todo lo creativo; el motor local solo rellena los
        // 6 básicos sobre él. Sin preset, plantilla mínima. IA: siempre plantilla mínima.
        let xmp = mode === "free" ? (presetTemplateText || DEFAULT_TEMPLATE) : DEFAULT_TEMPLATE;
        xmp = patchXmpAttributes(xmp, aiValues);
        xmp = addRatingAndLabel(xmp, {
          rating: photo.rating || 0,
          label: fromSession ? lightroomLabelFor(photo.colorLabel) : null,
        });
        xmp = addOrientation(xmp, photo.manualRotation || 0);
        out.push({ filename: photo.file.name, xmp, needsCorrection, allZero, values: aiValues });
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
    // Validación pre-ZIP: cada foto que necesita corrección debe tener valores no nulos.
    const needing = results.filter((r) => r.needsCorrection);
    const bad = needing.filter((r) => !r.values || Object.values(r.values).every((v) => !v));
    if (bad.length) {
      toast({
        title: "Validación fallida",
        description: `${bad.length} foto(s) necesitan corrección pero quedaron sin valores. Revisa antes de exportar.`,
        variant: "destructive",
      });
      return;
    }
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
                setProfile(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Cambiar carpeta
            </button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("free")}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === "free" ? "bg-white text-black" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                Auto Ajustes Básicos Pro — GRATIS
              </button>
              <button
                type="button"
                onClick={() => setMode("qwen")}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === "qwen" ? "bg-white text-black" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                Revelado IA Visual — Qwen
              </button>
              <button
                type="button"
                onClick={() => setMode("hybrid")}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === "hybrid" ? "bg-white text-black" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                Híbrido — IA Económico
              </button>
            </div>
            <PrecisionModeSelector value={precisionMode} onChange={setPrecisionMode} />
            {mode === "free" && (
              <>
                <p className="mt-4 text-xs text-zinc-500">
                  Motor matemático local 100 % determinista. Sin IA, sin créditos y sin subida de imágenes. Analiza
                  histograma RGB por canal + luminancia, clipping de altas luces y sombras, distribución tonal y contraste
                  global para calcular los 6 básicos: Exposure, Contrast, Highlights, Shadows, Whites y Blacks.
                </p>
                <PresetLoadSection
                  presetFile={presetFile}
                  onLoaded={(text, file) => { setPresetTemplateText(text); setPresetFile(file); }}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Opcional: el preset aporta todo lo creativo (temperatura, tint, vibración, estilo…); el motor local
                  solo rellena los 6 básicos sobre él. Sin preset se usa una plantilla mínima.
                </p>
              </>
            )}
            {mode === "hybrid" && (
              <>
                <p className="mt-4 text-sm font-medium text-zinc-100">Revelado Híbrido — IA Económico</p>
                <p className="mt-1 text-xs text-zinc-500">
                  La IA analiza solo unas pocas fotos representativas (1 llamada) y genera un perfil de sesión con el
                  look coherente. El motor local adapta ese perfil a cada foto corrigiendo exposición/luces/sombras
                  según su histograma real. Muy económico: 1 llamada de IA para toda la sesión, no 1 por foto. Selecciona
                  parámetros y preferencia (0 = sin desplazar).
                </p>
                <ParameterPanel config={config} onChange={setConfig} />
                {profile && (
                  <div className="mt-3 rounded-md border border-zinc-700 bg-zinc-900 p-3">
                    <p className="text-xs font-medium text-zinc-200">Perfil de sesión generado</p>
                    <p className="mt-1 text-xs text-zinc-500">{profile.analysis || "Sin descripción"}</p>
                    <p className="mt-1 text-xs text-zinc-500">Confianza: {profile.confidence ?? "—"}</p>
                  </div>
                )}
              </>
            )}
            {mode === "qwen" && (
              <>
                <p className="mt-4 text-sm font-medium text-zinc-100">Revelado IA Visual — Qwen</p>
                <p className="mt-1 text-xs text-zinc-500">
                  La IA analiza el contenido de cada foto (sujeto, luz, color, mood) y decide los ajustes de revelado
                  completos, no solo el histograma. Selecciona qué parámetros aplicar; la preferencia es un
                  desplazamiento que se suma a la decisión de la IA (0 = sin desplazar).
                </p>
                <ParameterPanel config={config} onChange={setConfig} />
              </>
            )}
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
              <p className="text-xs text-zinc-400">
                Validación: {results.filter((r) => r.needsCorrection).length} fotos con corrección aplicada ·{" "}
                {results.filter((r) => !r.needsCorrection).length} ya equilibradas (sin ajuste).
              </p>
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