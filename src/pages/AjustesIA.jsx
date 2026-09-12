import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, Sparkles, Package, Plug, CheckCircle2, ArrowLeft, Brain, Pause, Play, Download, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { runPool } from "@/lib/rawaistudio/promisePool";
import { analyzePhotometrics } from "@/lib/rawaistudio/photometricAnalysis";
import { computeAutoBasicsPro } from "@/lib/rawaistudio/autoBasicsEngine";
import { defaultParameterConfig, enabledKeys, preferencesFromConfig } from "@/lib/rawaistudio/paramDefs";
import { patchXmpAttributes, addRatingAndLabel, addOrientation, writeWhiteBalance } from "@/lib/rawaistudio/xmpTagPatcher";
import { sanitizeTreatment } from "@/lib/style/treatmentSanitizer";
import WbBreakdown from "@/components/rawaistudio/WbBreakdown";
import { styleProfileToXmpTemplate } from "@/lib/style/styleProfileToXmpTemplate";
import { lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { computeFolderKey, savePartialResults, loadPartialResults, clearPartialResults } from "@/lib/rawaistudio/batchProgress";
import { getSession } from "@/lib/rawaistudio/localSession";
import { developPhotosVisual, generateSessionProfile } from "@/lib/ai/aiGateway";
import { pickRepresentatives, adaptPhotoWithProfile } from "@/lib/rawaistudio/hybridAdaptEngine";
import { useToast } from "@/components/ui/use-toast";
import PrecisionModeSelector from "@/components/rawaistudio/PrecisionModeSelector";
import ParameterPanel from "@/components/rawaistudio/ParameterPanel";
import PresetLoadSection from "@/components/rawaistudio/PresetLoadSection";
import HybridValidationPanel from "@/components/rawaistudio/HybridValidationPanel";
import PerformanceMetrics from "@/components/rawaistudio/PerformanceMetrics";

// Plantilla XMP mínima cuando no hay preset .xmp: define el namespace crs y deja
// que la IA rellene los básicos. (Mismo contrato que EditorStudio.)
const DEFAULT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:Version="15.0"
      crs:ProcessVersion="15.0"/>
  </rdf:RDF>
</x:xmpmeta>`;

// Capa técnica: los 6 básicos que el motor IA (autoBasicsEngine / hybridAdaptEngine)
// calcula por foto. Cuando hay una plantilla de estilo/preset (presetTemplateText), la IA
// solo aporta estos 6 básicos; los creativos (Vibrance/Saturation/Clarity/Texture/Dehaze/
// Sharpness) vienen del perfil/preset y NO se sobreescriben. Así se respeta la separación
// de capas: perfil = look creativo, IA = básicos, WB = Kelvin absoluto. La sanitización
// del tratamiento Color/Monocromo vive en src/lib/style/treatmentSanitizer.js.
const TECHNICAL_KEYS = ["Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012"];
function restrictToTechnicalBasics(values, hasTemplate) {
  if (!hasTemplate) return values;
  const out = {};
  for (const k of TECHNICAL_KEYS) if (typeof values[k] === "number") out[k] = values[k];
  return out;
}

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
  const [treatment, setTreatment] = useState("auto"); // "auto" | "color" | "monochrome"
  const [mode, setMode] = useState("free"); // "free" (GRATIS, determinista) | "qwen" (IA)
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [zipping, setZipping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [presetTemplateText, setPresetTemplateText] = useState("");
  const [presetFile, setPresetFile] = useState(null);
  const [editStyleMode, setEditStyleMode] = useState("none");
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profile, setProfile] = useState(null);
  const [samples, setSamples] = useState([]);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extDone, setExtDone] = useState(0);
  const [metrics, setMetrics] = useState(null);
  // ---- Cerebro: presets y estilos registrados del fotógrafo ----
  const [cerebroPresets, setCerebroPresets] = useState([]);
  const [selectedCerebroPreset, setSelectedCerebroPreset] = useState(null);
  const [cerebroStyles, setCerebroStyles] = useState([]);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [loadingStylePreset, setLoadingStylePreset] = useState(false);
  // Proveedor activo por herramienta AJUSTES (Proveedores IA): el modelo que analiza y
  // edita SIEMPRE en los modos IA Visual e Híbrido. Solo para las etiquetas de los modos.
  const [ajustesProviderName, setAjustesProviderName] = useState("");
  // Pausar/Reanudar: el lote puede detenerse en cualquier momento (el usuario descarga
  // lo editado hasta ese punto) y reanudarse — incluso otro día, cerrando el navegador:
  // los XMP parciales se persisten en localStorage por carpeta. Al reanudar, las fotos
  // que ya tienen XMP se saltan automáticamente (sin repetir trabajo ni gastar IA).
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const outRef = useRef([]);
  const okRef = useRef(0);
  const errorsRef = useRef([]);

  // Restaura resultados parciales de una sesión anterior (mismos nombres de archivo).
  // Precarga outRef con las fotos que ya tienen XMP y activa el estado "pausado" para
  // que el usuario vea "Reanudar" en vez de "Procesar".
  const restorePartialResults = (loaded) => {
    const folderKey = computeFolderKey(loaded);
    const saved = loadPartialResults(folderKey);
    if (!saved?.length) return;
    const out = new Array(loaded.length).fill(null);
    let count = 0;
    for (let i = 0; i < loaded.length; i++) {
      const match = saved.find((r) => r.filename === loaded[i].file?.name);
      if (match) { out[i] = match; count++; }
    }
    if (count > 0) {
      outRef.current = out;
      okRef.current = count;
      errorsRef.current = [];
      setResults(out.filter(Boolean));
      setPaused(true);
      setProgress({ done: count, total: loaded.length });
      toast({ title: `${count} fotos ya editadas`, description: "Pulsa Reanudar para continuar con las restantes." });
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const list = await base44.entities.AiProviderConfig.list();
        const cfg = Array.isArray(list) && list.length ? list[0] : null;
        const active = String(cfg?.active_ajustes || "").trim();
        if (!active || active === "none") { setAjustesProviderName("sin proveedor"); return; }
        if (active.startsWith("custom:")) {
          const customs = await base44.entities.CustomAiProvider.list();
          const rec = (Array.isArray(customs) ? customs : []).find((c) => c.id === active.slice("custom:".length));
          setAjustesProviderName(rec?.name || "Proveedor activo");
          return;
        }
        setAjustesProviderName({ qwen: "Qwen", gemini: "Google Gemini", nvidia: "NVIDIA", base44: "Base44" }[active] || "Proveedor activo");
      } catch { setAjustesProviderName(""); }
    })();
  }, []);

  const enabledParams = useMemo(() => enabledKeys(config), [config]);
  const preferences = useMemo(() => preferencesFromConfig(config), [config]);

  useEffect(() => {
    setAwaitingConfirm(false);
    setSamples([]);
    setPaused(false);
    pausedRef.current = false;
  }, [mode]);

  useEffect(() => {
    base44.entities.PhotographerStyleProfile.list("-created_date", 50)
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  // Cerebro: carga los presets y estilos registrados del fotógrafo.
  useEffect(() => {
    base44.entities.PresetRegistry.list("-created_date", 100)
      .then(setCerebroPresets)
      .catch(() => setCerebroPresets([]));
    base44.entities.PhotographerStyle.list("-created_date", 100)
      .then(setCerebroStyles)
      .catch(() => setCerebroStyles([]));
  }, []);

  const chooseEditStyle = (styleMode) => {
    setEditStyleMode(styleMode);
    if (styleMode === "none") {
      setPresetTemplateText("");
      setPresetFile(null);
      setSelectedProfile(null);
      setSelectedCerebroPreset(null);
      setSelectedStyle(null);
    } else if (styleMode === "preset") {
      setSelectedProfile(null);
      setSelectedStyle(null);
      setSelectedCerebroPreset(null);
      setPresetTemplateText("");
      setPresetFile(null);
    } else if (styleMode === "mis-estilos") {
      setSelectedProfile(null);
      setPresetFile(null);
      setPresetTemplateText("");
    }
  };

  const chooseProfile = (profile) => {
    setSelectedProfile(profile);
    setPresetTemplateText(styleProfileToXmpTemplate(profile));
    setPresetFile(null);
  };

  // ---- Cerebro: integración de presets y estilos como ENTRADA del motor ----
  // No modifica los motores: solo carga la plantilla del preset como presetTemplateText
  // (la misma variable que ya usa el motor) y, al procesar, registra el estilo.
  const fetchPresetTemplate = async (preset) => {
    if (!preset?.preset_file_url) return "";
    try {
      const res = await fetch(preset.preset_file_url);
      return await res.text();
    } catch {
      return "";
    }
  };

  const selectCerebroPreset = async (preset) => {
    setSelectedCerebroPreset(preset);
    setSelectedStyle(null);
    setLoadingStylePreset(true);
    const text = await fetchPresetTemplate(preset);
    setPresetTemplateText(text);
    setPresetFile(null);
    setLoadingStylePreset(false);
  };

  const selectCerebroStyle = async (style) => {
    setSelectedStyle(style);
    const preset = cerebroPresets.find((p) => p.id === style.preset_id);
    if (preset) {
      setSelectedCerebroPreset(preset);
      setLoadingStylePreset(true);
      const text = await fetchPresetTemplate(preset);
      setPresetTemplateText(text);
      setPresetFile(null);
      setLoadingStylePreset(false);
    }
  };

  // Cerebro: registra/actualiza el estilo asociado al preset tras un procesamiento.
  // Identidad = preset_id + usuario → no crea duplicados; acumula photos_processed
  // y conserva initial_config (snapshot de nacimiento) del primer uso.
  const registerStyleAfterProcess = async (count) => {
    if (!selectedCerebroPreset || !count) return;
    try {
      const existing = cerebroStyles.find((s) => s.preset_id === selectedCerebroPreset.id);
      const nowIso = new Date().toISOString();
      if (existing) {
        await base44.entities.PhotographerStyle.update(existing.id, {
          photos_processed: (existing.photos_processed || 0) + count,
          last_updated: nowIso,
        });
        setCerebroStyles((prev) => prev.map((s) => s.id === existing.id
          ? { ...s, photos_processed: (s.photos_processed || 0) + count, last_updated: nowIso }
          : s));
      } else {
        const created = await base44.entities.PhotographerStyle.create({
          name: `${selectedCerebroPreset.name} — Estilo`,
          preset_id: selectedCerebroPreset.id,
          preset_name: selectedCerebroPreset.name,
          preset_version: selectedCerebroPreset.version || "v1",
          initial_config: {
            mode,
            precisionMode,
            treatment,
            preset_name: selectedCerebroPreset.name,
            preset_version: selectedCerebroPreset.version,
            parameters: selectedCerebroPreset.parameters,
          },
          photos_processed: count,
          last_updated: nowIso,
        });
        setCerebroStyles((prev) => [created, ...prev]);
      }
    } catch (e) {
      console.error("registerStyleAfterProcess", e?.message || e);
    }
  };

  const loadSessionPhotos = () => {
    if (!session.photos?.length) return;
    const loaded = session.photos.map((p) => ({
      ...p,
      manualRotation: p.manualRotation ?? 0,
      rating: p.rating ?? 0,
      colorLabel: p.colorLabel ?? "none",
    }));
    setPhotos(loaded);
    setFromSession(true);
    setResults([]);
    setSynced(false);
    setPaused(false);
    pausedRef.current = false;
    outRef.current = [];
    okRef.current = 0;
    errorsRef.current = [];
    // Restaura resultados parciales de una sesión anterior (mismas fotos = misma clave).
    restorePartialResults(loaded);
  };

  // Al llegar desde un proyecto («Editar» en el espacio de trabajo), las fotos
  // seleccionadas ya están en la sesión: se cargan automáticamente, sin pedir
  // de nuevo la carpeta RAW.
  useEffect(() => {
    loadSessionPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (list) => {
    const raws = Array.from(list || []).filter((f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name));
    if (!raws.length) return;
    setPhotos([]);
    setFromSession(false);
    setResults([]);
    setSynced(false);
    setPaused(false);
    pausedRef.current = false;
    outRef.current = [];
    okRef.current = 0;
    errorsRef.current = [];
    runExtract(raws);
  };

  const runExtract = async (raws) => {
    setExtracting(true);
    setExtDone(0);
    const totalStart = performance.now();
    const timing = { extractionMs: 0, skinMs: 0 };
    const items = raws.map((f, i) => ({ id: String(i), file: f }));
    const withPreview = await extractPreviews(items, (d) => setExtDone(d), (itemTiming) => {
      timing.extractionMs += itemTiming.extractionMs;
      timing.skinMs += itemTiming.skinMs;
    });
    setMetrics({ ...timing, photometricMs: 0, adaptationMs: 0, xmpMs: 0, zipMs: 0, totalMs: performance.now() - totalStart, photoCount: withPreview.length });
    const loaded = withPreview.map((p) => ({ ...p, manualRotation: 0, rating: 0, colorLabel: "none" }));
    setPhotos(loaded);
    setExtracting(false);
    // Restaura resultados parciales de una sesión anterior con esta misma carpeta.
    restorePartialResults(loaded);
  };

  const processAll = async (opts = {}) => {
    const { resume = false } = opts;
    if (!photos.length) return;
    if (mode === "hybrid") return runHybridPreview();
    // Inicio nuevo: resetea los refs. Reanudación: conserva lo procesado hasta la pausa.
    if (!resume) {
      outRef.current = new Array(photos.length).fill(null);
      okRef.current = 0;
      errorsRef.current = [];
    }
    pausedRef.current = false;
    setBusy(true);
    setPaused(false);
    if (!resume) setResults([]);
    setSynced(false);
    setAwaitingConfirm(false);
    const out = outRef.current;
    let ok = okRef.current;
    let done = out.filter(Boolean).length;
    const backendErrors = errorsRef.current;
    setProgress({ done, total: photos.length });
    // Procesa UNA foto: misma lógica que antes, extraída a función para que el pool
    // la pueda lanzar concurrentemente. Devuelve el resultado o lanza si falla.
    const processOnePhoto = async (photo) => {
        const base64 = photo.preview?.base64;
        const stats = base64 ? await analyzePhotometrics(base64) : null;
        let aiValues = {};
        let wb = null;
        let needsCorrection = false;
        let allZero = false;
        if (mode === "free") {
          // Auto Ajustes Básicos Pro — GRATIS: 100% determinista, cero llamadas IA/red.
          const pro = stats ? computeAutoBasicsPro(stats, precisionMode, photo.asShotWB, photo.skinStats) : null;
          aiValues = pro?.values || {};
          wb = pro?.wb || null;
          needsCorrection = !!pro?.needsCorrection;
          allZero = !!pro?.allZero;
        } else {
          // Revelado IA Visual (Qwen): la IA analiza el CONTENIDO de cada foto (sujeto,
          // luz, color, mood) y decide los ajustes de revelado completos, no solo el
          // histograma. Se filtra a los parámetros activados.
          // Fallback de imagen: preview.base64 puede no existir cuando el proyecto se
          // reabre desde la caché IndexedDB (que guarda { dataUrl, hiResDataUrl } sin
          // base64). Se deriva el base64 desde dataUrl para que la imagen llegue al
          // proveedor. No altera ninguna otra lógica.
          const base64ForVisual = base64
            || (photo.preview?.dataUrl ? photo.preview.dataUrl.split(",")[1] || "" : "");
          const data = await developPhotosVisual({
            photos: [{ id: photo.id, preview_base64: base64ForVisual }],
            preferences,
          });
          const all = data?.results?.[photo.id] || {};
          aiValues = {};
          for (const k of enabledParams) if (typeof all[k] === "number") aiValues[k] = all[k];
          // needsCorrection: la IA devolvió algún valor no nulo → hay corrección que aplicar.
          // Antes needsCorrection se quedaba siempre false en este modo, por eso el validador
          // mostraba "0 fotos con corrección aplicada" aunque la IA sí hubiera calculado valores.
          needsCorrection = Object.values(aiValues).some((v) => v !== 0);
          allZero = !needsCorrection;
          // Si el backend reportó un error para esta foto, se registra para avisar al usuario
          // (antes el error se tragaba en silencio y la foto quedaba "sin ajuste" sin razón visible).
          const errMsg = data?.errors?.[photo.id];
          if (errMsg) backendErrors.push(`${photo.file?.name || photo.id}: ${errMsg}`);
        }
        const finalValues = restrictToTechnicalBasics(aiValues, !!presetTemplateText);
        let xmp = presetTemplateText || DEFAULT_TEMPLATE;
        xmp = patchXmpAttributes(xmp, finalValues);
        xmp = sanitizeTreatment(xmp, treatment, photo.cameraInfo);
        xmp = writeWhiteBalance(xmp, wb);
        xmp = addRatingAndLabel(xmp, {
          rating: photo.rating || 0,
          label: photo.colorLabel && photo.colorLabel !== "none" ? lightroomLabelFor(photo.colorLabel) : null,
        });
        xmp = addOrientation(xmp, photo.manualRotation || 0);
        return { filename: photo.file.name, xmp, needsCorrection, allZero, values: finalValues, wb };
    };
    // Pool de concurrencia controlada: 4 fotos simultáneas, cada una con su propia
    // llamada IA. El índice original se preserva (out[i]) para que cada resultado se
    // asocie a la foto correcta. Los errores individuales se capturan y continúan sin
    // interrumpir el lote. El progreso se actualiza conforme termina cada foto.
    // PAUSA: pausedRef.current = true hace que los workers terminen su foto en curso
    // y salgan del bucle sin procesar más. Las fotos ya procesadas (out[i] !== null)
    // se saltan al reanudar, así no se repite trabajo ni se gastan créditos de IA.
    const CONCURRENCY = 4;
    let nextIdx = 0;
    const worker = async () => {
      while (true) {
        if (pausedRef.current) return;
        const i = nextIdx++;
        if (i >= photos.length) return;
        if (out[i] !== null) continue; // ya procesada (reanudación)
        try {
          out[i] = await processOnePhoto(photos[i]);
          ok++;
          okRef.current = ok;
        } catch {
          // Continúa con la siguiente aunque una falle.
        }
        done++;
        setProgress({ done, total: photos.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    const finalOut = out.filter(Boolean);
    setResults(finalOut);
    setBusy(false);
    const folderKey = computeFolderKey(photos);
    if (pausedRef.current) {
      // Pausado: el usuario detuvo el lote. Las fotos procesadas hasta aquí quedan
      // disponibles para descargar y se persisten en localStorage para reanudar otro día.
      setPaused(true);
      savePartialResults(folderKey, finalOut);
      toast({
        title: "Procesamiento pausado",
        description: `${finalOut.length} / ${photos.length} fotos procesadas. Puedes descargar lo editado o reanudar más tarde.`,
      });
    } else {
      // Completado: limpia los parciales guardados (el lote está entero y descargable).
      clearPartialResults(folderKey);
      if (backendErrors.length) {
        toast({
          title: `${backendErrors.length} foto(s) no procesadas por la IA`,
          description: backendErrors[0]?.slice(0, 300),
          variant: "destructive",
        });
      } else {
        toast({ title: "Procesamiento completado", description: `${ok} / ${photos.length} XMP listos` });
      }
      registerStyleAfterProcess(ok);
    }
  };

  // Pausa el lote en curso: los workers terminan su foto actual y salen. Las fotos
  // ya procesadas quedan en results para descargar; al reanudar se saltan automáticamente.
  const pauseProcessing = () => {
    pausedRef.current = true;
  };

  // Reanuda el lote desde donde se pausó: conserva las fotos ya procesadas y lanza
  // el pool solo sobre las pendientes (out[i] === null).
  const resumeProcessing = () => {
    processAll({ resume: true });
  };

  // Descarta los resultados parciales y vuelve al estado inicial ("Procesar").
  // Borra también lo guardado en localStorage para esta carpeta.
  const discardPartial = () => {
    const folderKey = computeFolderKey(photos);
    clearPartialResults(folderKey);
    outRef.current = [];
    okRef.current = 0;
    errorsRef.current = [];
    setResults([]);
    setPaused(false);
    setProgress({ done: 0, total: photos.length });
  };

  // FASE 1 del Revelado Híbrido: 1 llamada IA con K representantes → perfil de sesión,
  // y aplica el motor local a 5 fotos de muestra. Muestra la validación ANTES de procesar
  // toda la sesión. No consume más IA (el resto es adaptación local por foto).
  const runHybridPreview = async () => {
    const totalStart = performance.now();
    const timing = { photometricMs: 0, adaptationMs: 0, xmpMs: 0, zipMs: 0 };
    setBusy(true);
    setResults([]);
    setSynced(false);
    setSamples([]);
    setAwaitingConfirm(false);
    try {
      const reps = pickRepresentatives(photos, 8);
      // Fallback de imagen: mismo principio que processAll — preview.base64 puede no
      // existir en fotos reabiertas desde la caché IndexedDB. Se deriva desde dataUrl.
      const repData = reps
        .map((p) => ({
          id: p.id,
          preview_base64: p.preview?.base64
            || (p.preview?.dataUrl ? p.preview.dataUrl.split(",")[1] || "" : ""),
        }))
        .filter((p) => p.preview_base64);
      if (!repData.length) {
        toast({ title: "Sin previews", description: "No hay previews para analizar", variant: "destructive" });
        setBusy(false);
        return;
      }
      const data = await generateSessionProfile({ representatives: repData, preferences });
      const sessionProfile = data?.profile || null;
      setProfile(sessionProfile);
      // 5 fotos de muestra (muestreo uniforme) con sus valores finales adaptados localmente.
      const samplePhotos = pickRepresentatives(photos, 5);
      const sampleOut = [];
      for (const photo of samplePhotos) {
        const base64 = photo.preview?.base64;
        const photometricStart = performance.now();
        const stats = base64 ? await analyzePhotometrics(base64, photo.preview?.decodedSource) : null;
        timing.photometricMs += performance.now() - photometricStart;
        const adaptationStart = performance.now();
        const { values: rawValues, wb: sampleWb } = adaptPhotoWithProfile(stats, sessionProfile, precisionMode, preferences, enabledParams, photo.asShotWB, photo.skinStats);
        timing.adaptationMs += performance.now() - adaptationStart;
        const values = restrictToTechnicalBasics(rawValues, !!presetTemplateText);
        sampleOut.push({ id: photo.id, filename: photo.file.name, preview: base64, values, wb: sampleWb });
      }
      setMetrics((previous) => ({ ...(previous || {}), ...timing, totalMs: performance.now() - totalStart, photoCount: photos.length }));
      setSamples(sampleOut);
      setAwaitingConfirm(true);
    } catch (e) {
      toast({ title: "Error al generar el perfil", description: e.message, variant: "destructive" });
    }
    setBusy(false);
  };

  // FASE 2 del Revelado Híbrido: tras la validación, aplica el perfil a TODAS las fotos
  // (adaptación local por foto, sin más llamadas IA) y deja los XMP listos para exportar.
  const confirmHybridAll = async () => {
    if (!profile) return;
    const totalStart = performance.now();
    const timing = { photometricMs: 0, adaptationMs: 0, xmpMs: 0, zipMs: 0 };
    setBusy(true);
    setAwaitingConfirm(false);
    setResults([]);
    setProgress({ done: 0, total: photos.length });
    let completed = 0;
    const processed = await runPool(photos, 4, async (photo) => {
      try {
        const base64 = photo.preview?.base64;
        const photometricStart = performance.now();
        const stats = base64 ? await analyzePhotometrics(base64, photo.preview?.decodedSource) : null;
        const photometricMs = performance.now() - photometricStart;
        const adaptationStart = performance.now();
        const { values: rawValues, wb } = adaptPhotoWithProfile(stats, profile, precisionMode, preferences, enabledParams, photo.asShotWB, photo.skinStats);
        const adaptationMs = performance.now() - adaptationStart;
        const aiValues = restrictToTechnicalBasics(rawValues, !!presetTemplateText);
        const needsCorrection = Object.values(aiValues).some((v) => v) || (wb?.write && Math.abs(wb.temperatureDelta) > 0);
        const allZero = !needsCorrection;
        const xmpStart = performance.now();
        let xmp = presetTemplateText || DEFAULT_TEMPLATE;
        xmp = patchXmpAttributes(xmp, aiValues);
        xmp = sanitizeTreatment(xmp, treatment, photo.cameraInfo);
        xmp = writeWhiteBalance(xmp, wb);
        xmp = addRatingAndLabel(xmp, {
          rating: photo.rating || 0,
          label: photo.colorLabel && photo.colorLabel !== "none" ? lightroomLabelFor(photo.colorLabel) : null,
        });
        xmp = addOrientation(xmp, photo.manualRotation || 0);
        const xmpMs = performance.now() - xmpStart;
        timing.photometricMs += photometricMs;
        timing.adaptationMs += adaptationMs;
        timing.xmpMs += xmpMs;
        return { filename: photo.file.name, xmp, needsCorrection, allZero, values: aiValues, wb };
      } catch {
        // Continúa con la siguiente aunque una falle.
        return null;
      }
    }, () => {
      completed += 1;
      setProgress({ done: completed, total: photos.length });
    });
    const out = processed.filter(Boolean);
    setMetrics((previous) => ({ ...(previous || {}), ...timing, totalMs: performance.now() - totalStart, photoCount: out.length }));
    setResults(out);
    setBusy(false);
    toast({ title: "Procesamiento completado", description: `${out.length} / ${photos.length} XMP listos` });
    registerStyleAfterProcess(out.length);
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
    const zipStart = performance.now();
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
    setMetrics((previous) => previous ? { ...previous, zipMs: performance.now() - zipStart } : previous);
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
    <div className="min-h-[calc(100vh-4rem)] rounded-xl bg-background p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Ajustes IA</p>
          <h1 className="mt-1 text-2xl font-semibold">Revelado IA independiente</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Plantilla mínima. Sin preset ni selección previa.
            {fromSession ? ` ${photos.length} fotos desde la sesión.` : ""}
          </p>
        </div>
        <button
          onClick={() => navigate("/herramientas")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Herramientas
        </button>
      </div>

      {photos.length === 0 && !extracting && (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          {session.photos?.length ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Hay {session.photos.length} fotos en la sesión (flujo combinado).
              </p>
              <button
                onClick={loadSessionPhotos}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
              >
                <Sparkles className="h-4 w-4" /> Usar {session.photos.length} fotos de la sesión
              </button>
              <p className="text-xs text-muted-foreground">o carga tu propia carpeta:</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary">
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
              <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">Selecciona la carpeta de RAW</p>
              <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
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
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium">Leyendo previews embebidas</p>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {extDone} procesadas
          </p>
        </div>
      )}

      {photos.length > 0 && !extracting && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-emerald-600">
              {photos.length} fotos cargadas{fromSession ? " (sesión)" : ""}
            </p>
            <button
              onClick={() => {
                setPhotos([]);
                setResults([]);
                setProfile(null);
                setPaused(false);
                pausedRef.current = false;
                outRef.current = [];
                okRef.current = 0;
                errorsRef.current = [];
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Cambiar carpeta
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("free")}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === "free" ? "bg-accent text-accent-foreground" : "border border-border text-foreground hover:bg-secondary"}`}
              >
                Auto Ajustes Básicos Pro — GRATIS
              </button>
              <button
                type="button"
                onClick={() => setMode("qwen")}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === "qwen" ? "bg-accent text-accent-foreground" : "border border-border text-foreground hover:bg-secondary"}`}
              >
                Revelado IA Visual — {ajustesProviderName || "IA activa"}
              </button>
              <button
                type="button"
                onClick={() => setMode("hybrid")}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${mode === "hybrid" ? "bg-accent text-accent-foreground" : "border border-border text-foreground hover:bg-secondary"}`}
              >
                Híbrido — IA Económico
              </button>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Estilo de edición</p>
              <div className="flex items-center gap-2">
                {[
                  { id: "none", label: "Sin estilo" },
                  { id: "preset", label: "Preset" },
                  { id: "profile", label: "Perfil de fotógrafo" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => chooseEditStyle(opt.id)}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${editStyleMode === opt.id ? "bg-accent text-accent-foreground" : "border border-border text-foreground hover:bg-secondary"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => chooseEditStyle("mis-estilos")}
                className={`mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${editStyleMode === "mis-estilos" ? "bg-emerald-600 text-white" : "border border-emerald-600 text-emerald-700 hover:bg-emerald-50"}`}
              >
                <Brain className="h-3.5 w-3.5" /> ✨ Mis Estilos
              </button>
              {editStyleMode === "preset" && (
                <div className="mt-2 space-y-2">
                  {cerebroPresets.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Presets registrados en Cerebro:</p>
                      <select
                        value={selectedCerebroPreset?.id || ""}
                        onChange={(e) => {
                          const p = cerebroPresets.find((x) => x.id === e.target.value);
                          if (p) selectCerebroPreset(p);
                        }}
                        className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground"
                      >
                        <option value="">Selecciona un preset…</option>
                        {cerebroPresets.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}{p.version ? ` (${p.version})` : ""}</option>
                        ))}
                      </select>
                      {loadingStylePreset && <p className="mt-1 text-xs text-muted-foreground">Cargando preset…</p>}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">o carga un preset .xmp local en el bloque de abajo.</p>
                </div>
              )}
              {editStyleMode === "profile" && (
                <div className="mt-2">
                  {profiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No tienes perfiles guardados. Crea uno en{" "}
                      <button onClick={() => navigate("/estilos")} className="text-accent underline">Creador de estilos</button>.
                    </p>
                  ) : (
                    <select
                      value={selectedProfile?.id || ""}
                      onChange={(e) => {
                        const p = profiles.find((x) => x.id === e.target.value);
                        if (p) chooseProfile(p);
                      }}
                      className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground"
                    >
                      <option value="">Selecciona un perfil…</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {editStyleMode === "mis-estilos" && (
                <div className="mt-2">
                  {cerebroStyles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No tienes estilos guardados. Procesa fotos con un preset de Cerebro para crear uno automáticamente.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {cerebroStyles.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => selectCerebroStyle(s)}
                          className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${selectedStyle?.id === s.id ? "border-emerald-600 bg-emerald-50" : "border-border hover:bg-secondary"}`}
                        >
                          <p className="font-semibold text-foreground">{s.name}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {s.photos_processed || 0} fotos · {s.learning_percentage || 0}% aprendizaje · {s.correction_count || 0} correcciones
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedStyle && (
                    <p className="mt-2 text-xs text-emerald-600">
                      Configuración automática aplicada: preset «{selectedStyle.preset_name}» cargado como plantilla de entrada.
                    </p>
                  )}
                </div>
              )}
            </div>
            <PrecisionModeSelector value={precisionMode} onChange={setPrecisionMode} />
            <div className="mt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Tratamiento</p>
              <div className="flex items-center gap-2">
                {[
                  { id: "auto", label: "Automático" },
                  { id: "color", label: "Color" },
                  { id: "monochrome", label: "Monocromo" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTreatment(opt.id)}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${treatment === opt.id ? "bg-accent text-accent-foreground" : "border border-border text-foreground hover:bg-secondary"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Automático respeta el sensor (color→Color, monocromo→B/N). Color fuerza color. Monocromo conserva B/N.
              </p>
            </div>
            {mode === "free" && (
              <>
                <p className="mt-4 text-xs text-muted-foreground">
                  Motor matemático local 100 % determinista. Sin IA, sin créditos y sin subida de imágenes. Analiza
                  histograma RGB por canal + luminancia, clipping de altas luces y sombras, distribución tonal y contraste
                  global para calcular los 6 básicos: Exposure, Contrast, Highlights, Shadows, Whites y Blacks.
                </p>
                {editStyleMode === "preset" && (
                  <>
                    <PresetLoadSection
                      presetFile={presetFile}
                      onLoaded={(text, file) => { setPresetTemplateText(text); setPresetFile(file); }}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Opcional: el preset aporta todo lo creativo (temperatura, tint, vibración, estilo…); el motor local
                      solo rellena los 6 básicos sobre él. Sin preset se usa una plantilla mínima.
                    </p>
                  </>
                )}
                {editStyleMode === "profile" && selectedProfile && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Aplicando el perfil <span className="text-foreground">{selectedProfile.name}</span> como capa creativa.
                    Los 6 básicos y el WB se calculan por foto.
                  </p>
                )}
              </>
            )}
            {mode === "hybrid" && (
              <>
                <p className="mt-4 text-sm font-medium text-foreground">Revelado Híbrido — IA Económico</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  La IA que trabaja es SIEMPRE el proveedor activo por herramienta AJUSTES{ajustesProviderName ? ` (${ajustesProviderName})` : ""}: analiza
                  solo unas pocas fotos representativas (1 llamada) y genera un perfil de sesión con el look coherente.
                  El motor local adapta ese perfil a cada foto corrigiendo exposición/luces/sombras según su histograma
                  real. Muy económico: 1 llamada de IA para toda la sesión, no 1 por foto. Selecciona parámetros y
                  preferencia (0 = sin desplazar).
                </p>
                {editStyleMode === "preset" && (
                  <>
                    <PresetLoadSection
                      presetFile={presetFile}
                      onLoaded={(text, file) => { setPresetTemplateText(text); setPresetFile(file); }}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Opcional: el preset aporta todo lo creativo (temperatura, tint, vibración, estilo…) como plantilla
                      base; la IA solo rellena los básicos sobre él. No afecta al cálculo del revelado IA.
                    </p>
                  </>
                )}
                {editStyleMode === "profile" && selectedProfile && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Aplicando el perfil <span className="text-foreground">{selectedProfile.name}</span> como capa creativa.
                    Los básicos y el WB se calculan por foto.
                  </p>
                )}
                <ParameterPanel config={config} onChange={setConfig} />
                {profile && (
                  <div className="mt-3 rounded-md border border-border bg-secondary p-3">
                    <p className="text-xs font-medium text-foreground">Perfil de sesión generado</p>
                    <p className="mt-1 text-xs text-muted-foreground">{profile.analysis || "Sin descripción"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Confianza: {profile.confidence ?? "—"}</p>
                  </div>
                )}
              </>
            )}
            {mode === "qwen" && (
              <>
                <p className="mt-4 text-sm font-medium text-foreground">Revelado IA Visual — {ajustesProviderName || "IA activa"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ajustesProviderName ? `Usa SIEMPRE el proveedor activo por herramienta AJUSTES (${ajustesProviderName}): ese modelo analiza el contenido de cada foto (sujeto, luz, color, mood) y decide los ajustes de revelado completos, no solo el histograma. ` : "La IA analiza el contenido de cada foto (sujeto, luz, color, mood) y decide los ajustes de revelado completos, no solo el histograma. "}
                  Selecciona qué parámetros aplicar; la preferencia es un desplazamiento que se suma a la decisión de la IA (0 = sin desplazar).
                </p>
                <ParameterPanel config={config} onChange={setConfig} />
              </>
            )}
          </div>

          {/* Procesar / Pausar / Reanudar: el botón cambia según el estado del lote.
              - Idle: «Procesar N fotos» (o «Generar perfil» en Híbrido).
              - Procesando: barra de progreso + «Pausar» (detiene tras la foto en curso).
              - Pausado: «Reanudar» (sigue saltando lo editado) + «Descargar parcial» +
                «Descartar» (empieza de cero). El estado pausado persiste en localStorage
                para reanudar otro día cerrando el navegador. */}
          {busy ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center justify-center gap-2 rounded-md bg-secondary px-4 py-3 text-sm font-semibold text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando… {progress.done} / {progress.total}
              </div>
              <button
                onClick={pauseProcessing}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
              >
                <Pause className="h-4 w-4" /> Pausar
              </button>
            </div>
          ) : paused ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center justify-center gap-2 rounded-md bg-secondary px-4 py-3 text-sm font-semibold text-foreground">
                <Pause className="h-4 w-4" /> Pausado · {progress.done} / {progress.total}
              </div>
              <button
                onClick={resumeProcessing}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90"
              >
                <Play className="h-4 w-4" /> Reanudar
              </button>
              <button
                onClick={downloadZip}
                disabled={zipping || results.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-40"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Descargar {results.length}
              </button>
              <button
                onClick={discardPartial}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-secondary"
                title="Descartar lo editado y empezar de cero"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => processAll()}
              disabled={awaitingConfirm}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              {mode === "hybrid"
                ? `Generar perfil y 5 muestras`
                : `Procesar ${photos.length} fotos`}
            </button>
          )}

          {awaitingConfirm && samples.length > 0 && (
            <HybridValidationPanel
              profile={profile}
              samples={samples}
              total={photos.length}
              confirming={busy}
              onConfirm={confirmHybridAll}
              onCancel={() => {
                setAwaitingConfirm(false);
                setSamples([]);
              }}
            />
          )}

          {results.length > 0 && !busy && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 space-y-4">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
                <p className="text-sm font-semibold">{results.length} XMP generados. Elige cómo exportarlos:</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Validación: {results.filter((r) => r.needsCorrection).length} fotos con corrección aplicada ·{" "}
                {results.filter((r) => !r.needsCorrection).length} ya equilibradas (sin ajuste).
              </p>
              <PerformanceMetrics metrics={metrics} />
              {results.some((r) => r.wb) && (
                <div className="rounded-md border border-border bg-card p-3 space-y-1.5">
                  <p className="text-xs font-medium text-foreground">Balance de blancos por foto</p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-hide">
                    {results.map((r) => (
                      <div key={r.filename} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground truncate">{r.filename}</span>
                        <WbBreakdown wb={r.wb} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={downloadZip}
                  disabled={zipping}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
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
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-40"
                    >
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Sincronizar con Lightroom
                    </button>
                  ))}
              </div>
              {!fromSession && (
                <p className="text-xs text-muted-foreground">
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