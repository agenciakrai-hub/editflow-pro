import { invokeVision, activeProviderFor } from "./aiProviderAdapter.ts";

// RAW AI Studio — motor de decisiones. Dos capas conceptuales:
//  1) Motor TÉCNICO (src/lib/rawaistudio/exposureEngine.js, en el cliente): mide la preview
//     con estadísticas fotométricas reales (percentiles, clipping) y calcula una propuesta
//     base determinista de Exposure2012/Highlights2012/Shadows2012/Whites2012/Blacks2012.
//  2) Motor INTELIGENTE (este archivo): la IA NO decide esos 5 parámetros desde cero — solo
//     puede aportar un AJUSTE CONTEXTUAL pequeño y acotado (sujetos, contraluz, flash...)
//     sobre la medición técnica ya calculada. Nunca la sustituye.
// El resto de parámetros creativos (Contraste, Vibración, Saturación, Claridad) siguen
// siendo decididos directamente por la IA como antes, sin medición técnica.
// Orden final: (base técnica + ajuste IA acotado) + preferencia del fotógrafo, para los
// parámetros ligados a exposición; correcciónNormalIA + preferencia para el resto.
// Los ABSOLUTE_RANGES son el límite técnico físico de cada parámetro (red de seguridad).
// Nunca toca balance de blancos, curvas, HSL, calibración, máscaras ni estilo artístico.
// Independiente del motor KR Auto (Wedding RAW AI) — módulo propio, sin dependencias cruzadas.
//
// LIMITACIÓN CONOCIDA: la preview analizada es el JPEG embebido por la propia cámara (ya
// lleva su picture style/curva/contraste), no datos RAW lineales del sensor — este entorno
// no tiene acceso a un decodificador RAW lineal. Es la mejor aproximación fotométrica
// disponible sin integrar un componente externo especializado en RAW (p.ej. LibRaw/dcraw).

const ABSOLUTE_RANGES: Record<string, { min: number; max: number }> = {
  Exposure2012: { min: -5, max: 5 },
  Contrast2012: { min: -100, max: 100 },
  Highlights2012: { min: -100, max: 100 },
  Shadows2012: { min: -100, max: 100 },
  Whites2012: { min: -100, max: 100 },
  Blacks2012: { min: -100, max: 100 },
  Vibrance: { min: -100, max: 100 },
  Saturation: { min: -100, max: 100 },
  Clarity2012: { min: -100, max: 100 },
  Sharpness: { min: 0, max: 60 }
};

// Debe coincidir con EXPOSURE_TIED_KEYS de src/lib/rawaistudio/exposureEngine.js.
const EXPOSURE_TIED_KEYS = ["Exposure2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012"];

// Cuánto puede desviarse el ajuste contextual de la IA respecto a la base técnica, según el
// modo de precisión elegido por el fotógrafo (ver PRECISION_MODES en exposureEngine.js).
const DELTA_LIMITS: Record<string, { ev: number; tone: number }> = {
  conservative: { ev: 0.2, tone: 10 },
  balanced: { ev: 0.35, tone: 18 },
  aggressive: { ev: 0.55, tone: 28 }
};

function base64ToFile(base64: string, name = "preview.jpg", mime = "image/jpeg") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

const clamp = (key: string, value: number) => {
  const range = ABSOLUTE_RANGES[key] || { min: -100, max: 100 };
  return Math.min(range.max, Math.max(range.min, value));
};

export async function analyzePhotoParams(
  base44: any,
  previewBase64: string | null,
  enabledParams: string[],
  preferences: Record<string, number>,
  technical?: { baseline?: Record<string, number> | null; technicalConfidence?: number | null; precisionMode?: string },
  previewFileUrl?: string,
  camera?: string | null
): Promise<{ values: Record<string, number>; confidence: number | null }> {
  if (!enabledParams || !enabledParams.length) return { values: {}, confidence: null };

  // El motor cloud (rawAiCloudProcessBatch) ya tiene la preview subida desde el paso de
  // subida del navegador — pasa previewFileUrl directamente para no volver a subirla aquí.
  let file_url = previewFileUrl;
  if (!file_url) {
    const file = base64ToFile(previewBase64 as string);
    const uploaded = await base44.integrations.Core.UploadFile({ file });
    file_url = uploaded.file_url;
  }
  if (!file_url) throw new Error("UploadFile no devolvió file_url");

  const baseline = technical?.baseline || null;
  const technicalConfidence = typeof technical?.technicalConfidence === "number" ? technical.technicalConfidence : null;
  const limits = DELTA_LIMITS[technical?.precisionMode || "balanced"] || DELTA_LIMITS.balanced;

  const properties: Record<string, any> = {};
  const lines: string[] = [];
  for (const key of enabledParams) {
    if (baseline && EXPOSURE_TIED_KEYS.includes(key) && typeof baseline[key] === "number") {
      const bound = key === "Exposure2012" ? limits.ev : limits.tone;
      properties[key] = { type: "number", description: `Small bounded contextual delta between ${-bound} and ${bound} to ADD on top of the technical baseline. Return 0 if the baseline already looks correct.` };
      lines.push(`- ${key}: technical measurement already computed = ${baseline[key]}. Return ONLY a contextual delta in [${-bound}, ${bound}] — never an absolute value.`);
    } else {
      const range = ABSOLUTE_RANGES[key] || { min: -100, max: 100 };
      properties[key] = { type: "number", description: `Physically valid value between ${range.min} and ${range.max}` };
      lines.push(`- ${key}`);
    }
  }
  properties.confidence_score = { type: "number", description: "0-100: how confident you are that the important subjects (faces, skin, wedding dress) are well exposed with these values." };

  const boundKeys = EXPOSURE_TIED_KEYS.filter((k) => enabledParams.includes(k));
  const hasSharpness = enabledParams.includes("Sharpness");
  const prompt = `You are a professional photo colorist working like Adobe Camera Raw / Lightroom, specialized in wedding photography.
You ONLY reveal photographs — you never generate, retouch or alter pixels, identity, anatomy, clothing or background.

ABSOLUTE PRIORITY: if there are people in the frame, THEY dictate every decision. Their faces and skin must end up well exposed, with natural contrast and natural, healthy skin color, before anything else in the scene — even if that means the background is not perfectly exposed. Only when there are no people at all in the photo should you optimize for the overall scene instead.

Before deciding values, identify the light type falling on the main subject(s): window light, backlight/contraluz, side light, or flash — and adjust your strategy accordingly: backlight/contraluz needs more shadow and highlight recovery to protect and reveal faces against a bright background; flash needs highlight control to avoid blown-out skin; side light needs a balanced shadow lift without flattening the modeling on the face; soft window light usually needs the least correction. Never let this analysis affect white balance or color — only exposure/tone strategy.

${baseline ? `A technical engine has already measured this photo's real tonal distribution (histogram percentiles, highlight/shadow clipping) and computed a baseline for: ${boundKeys.length ? boundKeys.join(", ") : "none"}.
Your job for those parameters is NOT to invent a new absolute value — decide only whether the actual scene (faces, skin, wedding dress, backlight, flash, important subjects) justifies a SMALL contextual correction on top of that technical baseline, following the people-first priority and light type above. Most of the time the correct answer is 0.` : ""}

For any other listed parameter, compute the NORMAL, technically correct, professional develop correction, exactly as an expert colorist would, always keeping the people/skin priority and detected light type in mind:
${lines.join("\n")}
${hasSharpness ? "\nFor Sharpness specifically: apply only a MODERATE amount to improve perceived detail (skin texture, eyes, fabric weave) — never oversharpen, never introduce halos, and never make skin look harsh or degraded. When in doubt, use less." : ""}

Do not imply or apply any change to white balance, tone curves, HSL, camera calibration, masks or artistic style — those stay exactly as they are in the photographer's own preset.

Return concrete numeric values and confidence_score.`;

  const schema = { type: "object", properties, required: [...enabledParams, "confidence_score"] };
  const result = await invokeVision(base44, {
    task: 'ajustes',
    prompt,
    file_urls: [file_url],
    response_json_schema: schema
  });

  const final: Record<string, number> = {};
  for (const key of enabledParams) {
    const preference = Number(preferences?.[key]) || 0;
    if (baseline && EXPOSURE_TIED_KEYS.includes(key) && typeof baseline[key] === "number") {
      const bound = key === "Exposure2012" ? limits.ev : limits.tone;
      const rawDelta = typeof result[key] === "number" ? result[key] : 0;
      const delta = Math.min(bound, Math.max(-bound, rawDelta));
      final[key] = clamp(key, baseline[key] + delta + preference);
    } else {
      const normalIA = clamp(key, typeof result[key] === "number" ? result[key] : 0);
      final[key] = clamp(key, normalIA + preference);
    }
  }

  // Personal Preference Layer (RAW AI Studio — Aprendizaje): el sistema ya calcula y guarda
  // estadísticas de aprendizaje por cámara (PersonalProfileRule/PersonalProfileVersion), pero
  // el motor NO las aplica todavía aquí a propósito. Un sesgo aprendido solo por cámara
  // (ej. "Leica +0.25 EV") sería incorrecto aplicado indiscriminadamente a interior/exterior
  // u otras situaciones muy distintas entre sí. `camera` se recibe ya preparado para cuando
  // exista suficiente segmentación (cámara + ISO + escena + iluminación + tipo de foto) para
  // activar esta capa de forma segura.
  void camera;

  const aiConfidence = typeof result.confidence_score === "number" ? Math.min(100, Math.max(0, result.confidence_score)) : 80;
  const confidence = technicalConfidence != null ? Math.min(aiConfidence, technicalConfidence) : aiConfidence;

  return { values: final, confidence };
}

// Tamaño de lote para agrupar varias fotos en una sola llamada InvokeLLM. El modelo de
// visión procesa varias imágenes a la vez: 1 llamada con 6 fotos es ~6x más rápida que 6
// llamadas individuales (mismo round-trip de red, mismo overhead de inferencia base).
// Es la diferencia de velocidad con la app de referencia: mismo motor, mismo prompt,
// pero N veces menos llamadas.
export const LLM_BATCH_SIZE = 6;

// Sube un lote de previews a almacenamiento y devuelve sus URLs. Para el flujo local
// (rawAiStudioAnalyze), donde las previews llegan como base64. El flujo cloud ya tiene
// las URLs subidas desde el navegador y pasa previewFileUrl directamente.
// Sube un lote de previews a almacenamiento y devuelve sus URLs. Para el flujo local
// (rawAiStudioAnalyze), donde las previews llegan como base64. El flujo cloud ya tiene
// las URLs subidas desde el navegador y pasa previewFileUrl directamente.
//
// NVIDIA: cuando el proveedor activo para `task` es nvidia, devuelve data URLs
// (data:image/jpeg;base64,...) directamente, SIN llamar a UploadFile. El adaptador
// NVIDIA acepta data URLs en image_url (OpenAI vision). Qwen/Base44 siguen usando
// UploadFile para obtener file_url http — su flujo no cambia.
export async function uploadPreviewBatch(
  base44: any,
  previews: Array<{ id: string; previewBase64: string }>,
  task?: "seleccion" | "ajustes"
): Promise<Record<string, string>> {
  if (task) {
    try {
      const provider = await activeProviderFor(base44, task);
      if (provider === "nvidia" || provider === "gemini") {
        const urls: Record<string, string> = {};
        for (const p of previews) urls[p.id] = `data:image/jpeg;base64,${p.previewBase64}`;
        return urls;
      }
      // Proveedores personalizados: NVIDIA NIM y Gemini (generativelanguage) aceptan y
      // prefieren data URLs inline (evita que el proveedor tenga que fetchear una URL http
      // externa, que puede colgarse o fallar). Otros custom (OpenRouter, etc.) siguen
      // usando UploadFile (URL http).
      if (typeof provider === "string" && provider.startsWith("custom:")) {
        const id = provider.slice("custom:".length);
        const rec = await base44.asServiceRole.entities.CustomAiProvider.get(id).catch(() => null);
        const ep = String(rec?.endpoint || "").toLowerCase();
        if (/integrate\.api\.nvidia\.com/.test(ep) || /generativelanguage\.googleapis\.com/.test(ep)) {
          const urls: Record<string, string> = {};
          for (const p of previews) urls[p.id] = `data:image/jpeg;base64,${p.previewBase64}`;
          return urls;
        }
      }
    } catch {
      // Si no se puede leer la config, se cae al flujo por defecto (UploadFile).
    }
  }
  const urls: Record<string, string> = {};
  await Promise.all(previews.map(async (p) => {
    const file = base64ToFile(p.previewBase64);
    const uploaded = await base44.integrations.Core.UploadFile({ file });
    urls[p.id] = uploaded.file_url;
  }));
  return urls;
}

// Analiza un lote de fotos en una SOLA llamada InvokeLLM. El modelo de visión recibe
// todas las previews a la vez (file_urls) y devuelve valores por foto (photo_0, photo_1…).
// El post-procesado por foto (baseline + delta + preferencia, clamp) es idéntico al de
// analyzePhotoParams — solo cambia cuántas fotos van en cada llamada, no la lógica.
// Mapeo de nombres que algunos proveedores (NVIDIA MiniMax M3, etc.) devuelven en
// minusculas o sin el sufijo "2012", al nombre canonico que usa el motor XMP.
const KEY_ALIASES: Record<string, string> = {
  exposure: "Exposure2012", "exposure2012": "Exposure2012",
  highlights: "Highlights2012", highlight: "Highlights2012", "highlights2012": "Highlights2012",
  shadows: "Shadows2012", shadow: "Shadows2012", "shadows2012": "Shadows2012",
  whites: "Whites2012", white: "Whites2012", "whites2012": "Whites2012",
  blacks: "Blacks2012", black: "Blacks2012", "blacks2012": "Blacks2012",
  contrast: "Contrast2012", "contrast2012": "Contrast2012",
  vibrance: "Vibrance", saturation: "Saturation",
  clarity: "Clarity2012", "clarity2012": "Clarity2012",
  sharpness: "Sharpness",
};

function normalizeKeys(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const out: any = {};
  for (const k of Object.keys(obj)) {
    const canon = KEY_ALIASES[String(k).toLowerCase()] || k;
    out[canon] = obj[k];
  }
  return out;
}

// Localiza el sub-objeto que realmente contiene los parametros habilitados. Algunos
// modelos devuelven la envoltura photo_0, o anidan bajo "adjustments"/"recommended",
// o devuelven el objeto plano. Normaliza nombres en cada candidato (un nivel).
function extractValuesObject(candidate: any, enabledParams: string[]): any {
  if (!candidate || typeof candidate !== "object") return null;
  const has = (o: any) => enabledParams.some((k) => typeof o[k] === "number");
  const norm = normalizeKeys(candidate);
  if (has(norm)) return norm;
  for (const k of Object.keys(norm)) {
    const v = norm[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const vn = normalizeKeys(v);
      if (has(vn)) return vn;
    }
  }
  return null;
}

export async function analyzePhotoBatchParams(
  base44: any,
  photos: Array<{ id: string; previewFileUrl: string; baseline: Record<string, number> | null; technicalConfidence: number | null; camera: string | null }>,
  enabledParams: string[],
  preferences: Record<string, number>,
  precisionMode: string
): Promise<{ values: Record<string, Record<string, number>>; confidences: Record<string, number | null>; errors: Record<string, string>; trace: any }> {
  const values: Record<string, Record<string, number>> = {};
  const confidences: Record<string, number | null> = {};
  const errors: Record<string, string> = {};

  if (!enabledParams || !enabledParams.length || !photos.length) {
    return { values, confidences, errors };
  }

  const limits = DELTA_LIMITS[precisionMode] || DELTA_LIMITS.balanced;
  const photoSections: string[] = [];
  const schemaProperties: Record<string, any> = {};
  const schemaRequired: string[] = [];
  const fileUrls: string[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    fileUrls.push(photo.previewFileUrl);
    const baseline = photo.baseline;
    const boundKeys = EXPOSURE_TIED_KEYS.filter((k) => enabledParams.includes(k) && baseline && typeof baseline[k] === "number");

    const lines: string[] = [];
    for (const key of enabledParams) {
      if (baseline && EXPOSURE_TIED_KEYS.includes(key) && typeof baseline[key] === "number") {
        const bound = key === "Exposure2012" ? limits.ev : limits.tone;
        lines.push(`- ${key}: technical baseline = ${baseline[key]}. Return ONLY a contextual delta in [${-bound}, ${bound}].`);
      } else {
        lines.push(`- ${key}`);
      }
    }
    photoSections.push(`Photo ${i}:\n${lines.join("\n")}${baseline && boundKeys.length ? `\n(Baseline already computed for: ${boundKeys.join(", ")})` : ""}`);

    const photoProps: Record<string, any> = {};
    for (const key of enabledParams) {
      if (baseline && EXPOSURE_TIED_KEYS.includes(key) && typeof baseline[key] === "number") {
        const bound = key === "Exposure2012" ? limits.ev : limits.tone;
        photoProps[key] = { type: "number", description: `Delta between ${-bound} and ${bound} on top of baseline.` };
      } else {
        const range = ABSOLUTE_RANGES[key] || { min: -100, max: 100 };
        photoProps[key] = { type: "number", description: `Value between ${range.min} and ${range.max}` };
      }
    }
    photoProps.confidence_score = { type: "number", description: "0-100 confidence." };
    schemaProperties[`photo_${i}`] = { type: "object", properties: photoProps, required: [...enabledParams, "confidence_score"] };
    schemaRequired.push(`photo_${i}`);
  }

  const hasSharpness = enabledParams.includes("Sharpness");
  const prompt = `You are a professional photo colorist working like Adobe Camera Raw / Lightroom, specialized in wedding photography.
You ONLY reveal photographs — you never generate, retouch or alter pixels, identity, anatomy, clothing or background.

ABSOLUTE PRIORITY: for EACH photo, if there are people in the frame, THEY dictate every decision. Their faces and skin must end up well exposed with natural, healthy skin color before anything else. Only when there are no people should you optimize for the overall scene.

Before deciding values for each photo, identify the light type on the main subject(s): window light, backlight/contraluz, side light, or flash — and adjust accordingly. Never let this affect white balance or color — only exposure/tone strategy.

For parameters where a technical baseline is given, return ONLY a small contextual DELTA on top of that baseline (0 if already correct). For all other listed parameters, compute the normal, technically correct professional correction.

You will analyze ${photos.length} photos. Here are the parameters for each:

${photoSections.join("\n\n")}
${hasSharpness ? "\nFor Sharpness: apply only a MODERATE amount — never oversharpen, never introduce halos." : ""}

Do not imply any change to white balance, tone curves, HSL, camera calibration, masks or artistic style.

Return a JSON object with keys photo_0, photo_1, ... each containing the numeric values and confidence_score for that photo.`;

  const schema = { type: "object", properties: schemaProperties, required: schemaRequired };

  const trace: any = { perPhoto: [] };
  let result: any;
  try {
    result = await invokeVision(base44, {
      task: 'ajustes',
      prompt,
      file_urls: fileUrls,
      response_json_schema: schema,
      _trace: trace,
    });
  } catch (e: any) {
    for (const p of photos) errors[p.id] = e.message;
    return { values, confidences, errors, trace: { ...trace, error: e.message } };
  }

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const rawNested = result[`photo_${i}`];
    // Normaliza nombres (exposure -> Exposure2012) y localiza el sub-objeto que contiene
    // los parametros (algunos modelos anidan bajo photo_0 / adjustments / recommended).
    let valuesObj = rawNested ? extractValuesObject(rawNested, enabledParams) : null;
    if (!valuesObj && photos.length === 1) valuesObj = extractValuesObject(result, enabledParams);
    if (!valuesObj) {
      errors[photo.id] = "No result for photo";
      trace.perPhoto.push({ id: photo.id, rawNested, valuesObj: null, final: null });
      continue;
    }
    const photoResult = valuesObj;

    const baseline = photo.baseline;
    const technicalConfidence = photo.technicalConfidence;
    const final: Record<string, number> = {};
    for (const key of enabledParams) {
      const preference = Number(preferences?.[key]) || 0;
      if (baseline && EXPOSURE_TIED_KEYS.includes(key) && typeof baseline[key] === "number") {
        const bound = key === "Exposure2012" ? limits.ev : limits.tone;
        const rawDelta = typeof photoResult[key] === "number" ? photoResult[key] : 0;
        const delta = Math.min(bound, Math.max(-bound, rawDelta));
        final[key] = clamp(key, baseline[key] + delta + preference);
      } else {
        const normalIA = clamp(key, typeof photoResult[key] === "number" ? photoResult[key] : 0);
        final[key] = clamp(key, normalIA + preference);
      }
    }
    values[photo.id] = final;
    const aiConfidence = typeof photoResult.confidence_score === "number" ? Math.min(100, Math.max(0, photoResult.confidence_score)) : 80;
    confidences[photo.id] = technicalConfidence != null ? Math.min(aiConfidence, technicalConfidence) : aiConfidence;
    trace.perPhoto.push({ id: photo.id, rawNested, valuesObj: photoResult, final });
  }

  return { values, confidences, errors, trace };
}