// AI Gateway / Provider Seam — frontera estable entre las páginas y el proveedor
// de inferencia. Las páginas (Seleccion.jsx, AjustesIA.jsx) llaman EXCLUSIVAMENTE
// a esta interfaz; nunca a InvokeLLM, rawAiSmartSelect, rawAiStudioAnalyze ni a
// ningún backend concreto. Hoy el gateway enruta a los motores existentes (que
// siguen usando Base44 InvokeLLM / claude_sonnet_4_6), con comportamiento idéntico.
//
// En una fase posterior, sustituir el proveedor (Anthropic / Qwen / API propia con
// API key + modelo + endpoint) implica cambiar solo este módulo (o el backend al
// que llama) — sin tocar Seleccion.jsx, AjustesIA.jsx, EditorStudio, XMP, Lightroom,
// localSession ni extractPreviews.

import { base44 } from "@/api/base44Client";
import { runAiBurstSelection } from "@/lib/rawaistudio/smartSelectionEngine";

// Selección IA (culling por escena). Delega en el motor existente sin modificarlo.
// withPreview: [{ id, file, preview, phash, captureTime, cameraInfo, technical }]
// onProgress(done) → { keep: Set<id>, meta: Map<id, {...}> }
export async function selectBursts(withPreview, onProgress) {
  return runAiBurstSelection(withPreview, onProgress);
}

// Ajustes IA (revelado). Hoy enruta a rawAiStudioAnalyze (InvokeLLM). La página no
// conoce la función backend concreta.
// photos: [{ id, preview_base64, baseline?, technical_confidence?, camera? }]
// Devuelve { results, errors, confidences }
export async function analyzePhotos({ photos, enabledParams, preferences, precisionMode }) {
  const res = await base44.functions.invoke("rawAiStudioAnalyze", {
    photos,
    enabled_params: enabledParams,
    preferences,
    precision_mode: precisionMode,
  });
  return res?.data ?? res;
}