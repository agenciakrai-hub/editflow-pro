// Creador de estilos — análisis de una galería pública para aprender el look global de
// un fotógrafo. NO usa InvokeLLM ni UploadFile: enruta EXCLUSIVAMENTE al proveedor externo
// configurado en active_ajustes (Gemini/Qwen/NVIDIA) vía invokeVision, enviando las
// imágenes representativas como data URLs directas. Una sola operación de análisis por
// perfil. Si el proveedor configurado no es externo, devuelve error (sin fallback a Base44).
//
// Entrada (JSON):
//   { gallery_url: string }
// Salida (JSON):
//   { color_profile, edit_profile, creative_recipe, confidence, source }
//
// creative_recipe contiene SOLO sliders creativos (Vibrance, Saturation, Clarity2012,
// Texture2012, Dehaze2012, Sharpness). Nunca Exposure/Contrast/Highlights/Shadows/Whites/
// Blacks/Temperature/Tint — el backend sanea y elimina cualquier básico que el modelo
// pudiera devolver.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { extractImageUrls } from "../../shared/galleryUrlExtractor.ts";
import { invokeVision, activeProviderFor } from "../../shared/aiProviderAdapter.ts";

const MAX_IMAGES = 6;
const CREATIVE_KEYS = ["Vibrance", "Saturation", "Clarity2012", "Texture2012", "Dehaze2012", "Sharpness"];

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'image/*',
      },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return `data:image/jpeg;base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const galleryUrl = String(body?.gallery_url || "").trim();
    if (!galleryUrl) return Response.json({ error: 'gallery_url requerido' }, { status: 400 });

    // Proveedor externo obligatorio. Nunca InvokeLLM/Base44, nunca failover silencioso.
    const provider = await activeProviderFor(base44, "ajustes");
    if (provider !== "qwen" && provider !== "gemini" && provider !== "nvidia") {
      return Response.json(
        { error: 'Proveedor externo requerido. Configura Gemini, Qwen o NVIDIA en "active_ajustes" (Proveedores IA). InvokeLLM no está permitido para estilos.' },
        { status: 400 }
      );
    }

    // Extraer imágenes de la galería pública (SmugMug, HTML galleries, URLs directas).
    const { urls, error } = await extractImageUrls(galleryUrl);
    if (error) return Response.json({ error }, { status: 400 });
    if (!urls || !urls.length) return Response.json({ error: 'No se encontraron imágenes en la galería' }, { status: 400 });

    // Muestra representativa (hasta MAX_IMAGES, repartida uniformemente sobre el total).
    const sample = urls.length <= MAX_IMAGES
      ? urls
      : urls.filter((_, i) => i % Math.ceil(urls.length / MAX_IMAGES) === 0).slice(0, MAX_IMAGES);

    const dataUrls: string[] = [];
    for (const u of sample) {
      const du = await fetchAsDataUrl(u);
      if (du) dataUrls.push(du);
    }
    if (!dataUrls.length) return Response.json({ error: 'No se pudieron descargar las imágenes de la galería' }, { status: 400 });

    const prompt = `Eres un colorista profesional que analiza el ESTILO global de un fotógrafo a partir de una muestra de su galería pública.
NO revelas ninguna foto concreta ni reconstruyes un preset exacto: aprendes el LOOK COHERENTE de su trabajo (color, contraste, acabado).

Analiza estas ${dataUrls.length} imágenes representativas y describe el estilo del fotógrafo separando COLOR y EDICIÓN/LOOK, y produce una receta creativa determinista.

Devuelve un JSON con esta estructura exacta:
{
  "color_profile": {
    "tendencia_color": "string corto (cálido/frío/neutro/pastel/sepia...)",
    "saturacion": "string corto (natural/vibrante/matizada/desaturada...)",
    "representacion_piel": "string corto (natural/airbrushed/bronceada...)",
    "caracter_tonal": "string corto (sombras lifts/contraste medio/cruciales...)",
    "contraste_creativo": "string corto (suave/medio/fuerte...)"
  },
  "edit_profile": {
    "tratamiento_luces": "string corto",
    "tratamiento_sombras": "string corto",
    "negros": "string corto",
    "suavidad_crispness": "string corto",
    "caracter_acabado": "string corto (limpio/granulado/cremoso...)",
    "consistencia": "string corto (alta/media...)"
  },
  "creative_recipe": {
    "Vibrance": número entre -100 y 100,
    "Saturation": número entre -100 y 100,
    "Clarity2012": número entre -100 y 100,
    "Texture2012": número entre -100 y 100,
    "Dehaze2012": número entre -100 y 100,
    "Sharpness": número entre 0 y 100
  },
  "confidence_score": número entre 0 y 100
}

REGLA CRÍTICA: creative_recipe SOLO contiene los 6 sliders creativos listados (Vibrance, Saturation, Clarity2012, Texture2012, Dehaze2012, Sharpness). NUNCA incluyas Exposure2012, Contrast2012, Highlights2012, Shadows2012, Whites2012, Blacks2012, Temperature ni Tint — esos parámetros NO son de estilo; se calculan por fotografía por el motor técnico. Si los incluyes, el perfil será inválido.

Usa el JSON exacto, sin texto adicional.`;

    const result: any = await invokeVision(base44, {
      task: "ajustes",
      prompt,
      file_urls: dataUrls,
      forceProvider: provider,
    } as any);

    // Saneo defensivo: creative_recipe solo con claves creativas válidas, sin básicos.
    const rawRecipe = (result?.creative_recipe && typeof result.creative_recipe === "object") ? result.creative_recipe : {};
    const cleanRecipe: Record<string, number> = {};
    for (const k of CREATIVE_KEYS) {
      const v = rawRecipe[k];
      if (typeof v === "number" && Number.isFinite(v)) cleanRecipe[k] = v;
    }

    return Response.json({
      color_profile: (result?.color_profile && typeof result.color_profile === "object") ? result.color_profile : {},
      edit_profile: (result?.edit_profile && typeof result.edit_profile === "object") ? result.edit_profile : {},
      creative_recipe: cleanRecipe,
      confidence: typeof result?.confidence_score === "number" ? Math.min(100, Math.max(0, result.confidence_score)) : 0,
      source: { gallery_url: galleryUrl, provider, image_count: dataUrls.length },
    });
  } catch (error: any) {
    console.error('styleGalleryAnalyze error', error?.message || error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}