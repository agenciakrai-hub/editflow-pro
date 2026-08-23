import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Download, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { analyzePhotometrics } from "@/lib/rawaistudio/photometricAnalysis";
import { computeTechnicalBaseline } from "@/lib/rawaistudio/exposureEngine";
import { defaultParameterConfig, enabledKeys, preferencesFromConfig } from "@/lib/rawaistudio/paramDefs";
import { resolveProfileChoiceForCamera, applyProfileChoice } from "@/lib/rawaistudio/presetProfile";
import { brandFromMake } from "@/lib/rawaistudio/cameraMetadata";
import { patchXmpAttributes, addRatingAndLabel, addOrientation } from "@/lib/rawaistudio/xmpTagPatcher";
import { lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { getSession } from "@/lib/rawaistudio/localSession";
import { useToast } from "@/components/ui/use-toast";
import CameraProfileSection from "@/components/rawaistudio/CameraProfileSection";
import PresetLoadSection from "@/components/rawaistudio/PresetLoadSection";
import ParameterPanel from "@/components/rawaistudio/ParameterPanel";
import PrecisionModeSelector from "@/components/rawaistudio/PrecisionModeSelector";

// Plantilla XMP mínima cuando el fotógrafo no carga un preset .xmp: define el namespace
// crs y deja que la IA rellene los básicos. Si hay preset, se parte siempre del XML real.
const DEFAULT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"/>
  </rdf:RDF>
</x:xmpmeta>`;

const xmpName = (name) => name.replace(/\.[^.]+$/, "") + ".xmp";

function downloadText(name, text) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Pantalla de EDICIÓN (local, mismo diseño que RAW AI Studio). Recibe la cola de edición
// desde la pantalla de Selección (sesión en memoria), configura perfil de cámara, preset
// .xmp y parámetros, procesa cada foto con la IA (rawAiStudioAnalyze) y descarga los XMP.
// Los RAW nunca se suben: solo la preview embebida se envía a la IA de revelado.
export default function EditorStudio() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = getSession();
  const [photos] = useState(session.photos);
  const [presetTemplateText, setPresetTemplateText] = useState(session.presetTemplateText || "");
  const [presetFile, setPresetFile] = useState(session.presetFile || null);
  const [config, setConfig] = useState(session.config || defaultParameterConfig());
  const [precisionMode, setPrecisionMode] = useState(session.precisionMode || "balanced");
  const [profileChoice, setProfileChoice] = useState(session.profileChoice || null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const enabledParams = useMemo(() => enabledKeys(config), [config]);
  const preferences = useMemo(() => preferencesFromConfig(config), [config]);

  if (!photos.length) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-10 text-center text-zinc-100">
        <p className="text-sm text-zinc-400">No hay fotos en la cola de edición.</p>
        <button onClick={() => navigate("/dashboard")}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
          <ArrowLeft className="h-4 w-4" /> Ir a selección
        </button>
      </div>
    );
  }

  const processAll = async () => {
    setBusy(true);
    setProgress({ done: 0, total: photos.length });
    let ok = 0;
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        const base64 = photo.preview?.base64;
        const stats = base64 ? await analyzePhotometrics(base64) : null;
        const baseline = stats ? computeTechnicalBaseline(stats, precisionMode) : null;
        const res = await base44.functions.invoke("rawAiStudioAnalyze", {
          photos: [{
            id: photo.id,
            preview_base64: base64,
            baseline: baseline?.values || null,
            technical_confidence: baseline?.confidence ?? null,
            camera: photo.cameraInfo?.brand || null,
          }],
          enabled_params: enabledParams,
          preferences,
          precision_mode: precisionMode,
        });
        const data = res?.data ?? res;
        const aiValues = data?.results?.[photo.id] || {};

        // Construye el XMP final: plantilla del preset + perfil/tratamiento + ajustes IA.
        let xmp = presetTemplateText || DEFAULT_TEMPLATE;
        const choice = resolveProfileChoiceForCamera(profileChoice, photo.cameraInfo);
        const applied = applyProfileChoice(xmp, photo.cameraInfo, choice, brandFromMake);
        xmp = patchXmpAttributes(applied.xmpText, aiValues);
        xmp = addRatingAndLabel(xmp, {
          rating: photo.rating || (photo.aiSelected ? 5 : 0),
          label: lightroomLabelFor(photo.colorLabel),
        });
        xmp = addOrientation(xmp, photo.manualRotation);
        downloadText(xmpName(photo.file.name), xmp);
        ok++;
      } catch (e) {
        // Continúa con la siguiente aunque una falle.
      }
      setProgress({ done: i + 1, total: photos.length });
      await new Promise((r) => setTimeout(r, 250)); // evita que el navegador bloquee las descargas
    }
    setBusy(false);
    toast({ title: "Procesamiento completado", description: `${ok} / ${photos.length} XMP descargados` });
  };

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-[#0a0a0a] p-6 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500">Editor IA</p>
          <h1 className="mt-1 text-2xl font-semibold">Revelado IA + exportación XMP</h1>
          <p className="mt-1 text-xs text-emerald-400">{photos.length} fotos en la cola de edición</p>
        </div>
        <button onClick={() => navigate("/dashboard")}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a selección
        </button>
      </div>

      <CameraProfileSection photos={photos} value={profileChoice} onChange={setProfileChoice} />

      <PresetLoadSection presetFile={presetFile}
        onLoaded={(text, file) => { setPresetTemplateText(text); setPresetFile(file); }} />

      <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
        <PrecisionModeSelector value={precisionMode} onChange={setPrecisionMode} />
        <p className="mt-4 text-sm font-medium text-zinc-100">Parámetros de revelado IA</p>
        <p className="mt-1 text-xs text-zinc-500">
          Activa los parámetros que la IA puede tocar. La "preferencia" es un desplazamiento
          que se suma a la corrección normal de la IA (0 = sin desplazar).
        </p>
        <ParameterPanel config={config} onChange={setConfig} />
      </div>

      <button onClick={processAll} disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? `Procesando… ${progress.done} / ${progress.total}` : `Procesar y descargar ${photos.length} XMP`}
      </button>
      {!busy && <p className="text-center text-xs text-zinc-500">Se descargará un .xmp por cada foto de la cola.</p>}
    </div>
  );
}