// Creador de estilos — análisis de una galería pública para aprender el look global de
// un fotógrafo. NO usa InvokeLLM ni UploadFile: enruta EXCLUSIVAMENTE al proveedor externo
// configurado en active_ajustes (Gemini/Qwen/NVIDIA) vía invokeVision, enviando las
// imágenes representativas como data URLs directas.
//
// Manejo de errores robusto: ningún fallo de red/proveedor/parser termina como 500
// genérico. Cada etapa devuelve un error controlado con { error, stage, provider?,
// model?, http_status? } y un mensaje legible (sin exponer la API key).
//   - gallery:  no se pudo acceder a la galería (red / HTTP 403,404...) o está protegida.
//   - images:   no se encontraron imágenes / no se pudo descargar ninguna válida.
//   - provider:  el proveedor IA devolvió error (503/429/otro) → se propaga con http_status.
//   - parser:    la respuesta no se pudo interpretar como perfil de estilo.
//
// Entrada (JSON): { gallery_url: string }
// Salida (JSON): { color_profile, edit_profile, creative_recipe, confidence, source }
// creative_recipe contiene SOLO sliders creativos; el backend sanea cualquier básico.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { extractImageUrls } from "../../shared/galleryUrlExtractor.ts";
import { invokeVision, activeProviderFor } from "../../shared/aiProviderAdapter.ts";

const MAX_IMAGES = 6;
const MIN_IMAGES = 1;
const CREATIVE_KEYS = ["Vibrance", "Saturation", "Clarity2012", "Texture2012", "Dehaze2012", "Sharpness"];

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'image/*,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

// Descarga una imagen a data URL. Devuelve { dataUrl } o { error, status }.
async function fetchAsDataUrl(url: string): Promise<{ dataUrl?: string; status?: number | null; error?: string }> {
  try {
    const res = await fetch(url, { headers: UA_HEADERS });
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) return { status: res.status, error: "respuesta vacía" };
    return { dataUrl: `data:image/jpeg;base64,${arrayBufferToBase64(buf)}` };
  } catch (e: any) {
    return { status: null, error: e?.message || "error de red" };
  }
}

// Sonda de acceso a la galería: distingue "bloqueada/inaccesible" de "sin imágenes".
async function probeGallery(url: string): Promise<{ ok: boolean; status: number | null; network: boolean }> {
  try {
    const res = await fetch(url, { headers: UA_HEADERS, redirect: "follow" });
    return { ok: res.ok, status: res.status, network: false };
  } catch {
    return { ok: false, status: null, network: true };
  }
}

function extractHttpStatus(msg: string): number | null {
  const m = String(msg || "").match(/HTTP\s+(\d{3})/i);
  return m ? Number(m[1]) : null;
}

async function getProviderModel(base44: any, provider: string): Promise<string> {
  try {
    const list = await base44.entities.AiProviderConfig.list();
    const cfg = Array.isArray(list) && list.length ? list[0] : {};
    return cfg[`${provider}_model`] || provider;
  } catch {
    return provider;
  }
}

function providerErrorMessage(provider: string, status: number | null): string {
  if (status === 503) return `El proveedor de IA (${provider}) está saturado temporalmente (HTTP 503). Reintenta en unos segundos.`;
  if (status === 429) return `El proveedor de IA (${provider}) ha limitado la tasa de peticiones (HTTP 429). Reintenta más tarde.`;
  if (status) return `El proveedor de IA (${provider}) devolvió un error (HTTP ${status}). Reintenta o cambia de proveedor en Proveedores IA.`;
  return `El proveedor de IA (${provider}) no respondió correctamente. Reintenta o cambia de proveedor en Proveedores IA.`;
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const galleryUrl = String(body?.gallery_url || "").trim();
    if (!galleryUrl) {
      return Response.json({ error: 'gallery_url requerido', stage: 'input' }, { status: 400 });
    }

    // Proveedor externo obligatorio. Nunca InvokeLLM/Base44, nunca fallback silencioso.
    const provider = await activeProviderFor(base44, "ajustes");
    if (provider !== "qwen" && provider !== "gemini" && provider !== "nvidia") {
      return Response.json(
        { error: 'Proveedor externo requerido. Configura Gemini, Qwen o NVIDIA en "active_ajustes" (Proveedores IA). InvokeLLM no está permitido para estilos.', stage: 'provider' },
        { status: 400 }
      );
    }
    const model = await getProviderModel(base44, provider);

    // 1) Extracción de imágenes de la galería pública.
    let extracted: { urls?: string[]; error?: string };
    try {
      extracted = await extractImageUrls(galleryUrl);
    } catch (e: any) {
      return Response.json(
        { error: 'No se pudo acceder a la galería (error de red). Verifica que la URL sea pública y accesible.', stage: 'gallery', detail: e?.message },
        { status: 502 }
      );
    }
    if (extracted.error) {
      return Response.json({ error: extracted.error, stage: 'gallery' }, { status: 400 });
    }
    const urls = extracted.urls || [];
    if (!urls.length) {
      const probe = await probeGallery(galleryUrl);
      if (!probe.ok) {
        const reason = probe.network ? "no se pudo conectar (red/DNS)" : `HTTP ${probe.status}`;
        return Response.json(
          { error: `No se pudo acceder a la galería (${reason}). Verifica que la URL sea pública y accesible.`, stage: 'gallery', http_status: probe.status },
          { status: 502 }
        );
      }
      return Response.json(
        { error: 'No se encontraron imágenes analizables en la galería. Asegúrate de que la página contenga <img> con URLs directas a fotos.', stage: 'images' },
        { status: 400 }
      );
    }

    // 2) Muestra representativa (hasta MAX_IMAGES, repartida uniformemente sobre el total).
    const sample = urls.length <= MAX_IMAGES
      ? urls
      : urls.filter((_, i) => i % Math.ceil(urls.length / MAX_IMAGES) === 0).slice(0, MAX_IMAGES);

    // 3) Descarga a data URLs. Salta fallos individuales y continúa con las válidas.
    const dataUrls: string[] = [];
    let failedCount = 0;
    for (const u of sample) {
      const r = await fetchAsDataUrl(u);
      if (r.dataUrl) dataUrls.push(r.dataUrl);
      else failedCount++;
    }
    if (dataUrls.length < MIN_IMAGES) {
      return Response.json(
        { error: `No se pudieron descargar imágenes válidas de la galería (${failedCount} fallo(s) sobre ${sample.length}). Reintenta o usa otra galería.`, stage: 'images', failed_count: failedCount },
        { status: 502 }
      );
    }

    // 4) invokeVision con un único reintento en 503/429 (saturación transitoria).
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

    let result: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await invokeVision(base44, {
          task: "ajustes",
          prompt,
          file_urls: dataUrls,
          forceProvider: provider,
        } as any);
        break;
      } catch (e: any) {
        const status = extractHttpStatus(e?.message);
        const transient = status === 503 || status === 429;
        if (transient && attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return Response.json(
          { error: providerErrorMessage(provider, status), stage: 'provider', provider, model, http_status: status },
          { status: transient ? status : 502 }
        );
      }
    }
    if (!result || typeof result !== "object") {
      return Response.json(
        { error: 'La respuesta del proveedor no se pudo interpretar como un perfil de estilo. Reintenta.', stage: 'parser', provider, model },
        { status: 502 }
      );
    }

    // 5) Saneo defensivo: creative_recipe solo con claves creativas válidas, sin básicos.
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
      source: { gallery_url: galleryUrl, provider, model, image_count: dataUrls.length },
    });
  } catch (error: any) {
    console.error('styleGalleryAnalyze error', error?.message || error);
    return Response.json(
      { error: 'Error inesperado al analizar el estilo. Reintenta.', stage: 'unknown', detail: error?.message },
      { status: 500 }
    );
  }
}