// EditFlow V2 — motor aislado. Solo transporte HTTP directo al proveedor externo.
// Recibe únicamente JPEG reducidos como data URLs; nunca archivos RAW ni rutas locales.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.48";
import { secrets } from "base44:runtime";

const MAX_IMAGES = 20;
const MAX_DATA_URL = 700000;

function normalizeMode(value: unknown): "basic" | "pro" {
  return value === "pro" ? "pro" : "basic";
}

function parseJson(value: unknown): any {
  if (value && typeof value === "object") return value;
  const text = String(value || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("El proveedor no devolvió JSON válido");
  return JSON.parse(text.slice(start, end + 1));
}

function modelScore(name: string, mode: "basic" | "pro"): number {
  const n = name.toLowerCase();
  const budget = ["flash-lite", "flash", "mini", "haiku", "nano", "small", "7b", "8b", "qwen3-vl-8b"];
  const premium = ["pro", "opus", "sonnet", "max", "gpt-5", "gpt-4.1", "qwen3-vl-plus", "72b"];
  const preferred = mode === "basic" ? budget : premium;
  const avoided = mode === "basic" ? premium : budget;
  let score = 0;
  preferred.forEach((token, index) => { if (n.includes(token)) score += 100 - index; });
  avoided.forEach((token) => { if (n.includes(token)) score -= 20; });
  if (/vision|\bvl\b|multimodal|gemini|gpt|claude/.test(n)) score += 10;
  return score;
}

async function providerFor(base44: any, task: "seleccion" | "ajustes" | "album", mode: "basic" | "pro") {
  const rows = await base44.asServiceRole.entities.CustomAiProvider.list(200);
  const candidates = (Array.isArray(rows) ? rows : []).filter((row: any) => row.enabled !== false && row.last_ok !== false);
  const field = task === "seleccion" ? "seleccion_models" : task === "ajustes" ? "ajustes_models" : "album_models";
  const ranked: any[] = [];
  for (const row of candidates) {
    const models = (Array.isArray(row[field]) ? row[field] : []).map(String).filter(Boolean);
    for (const model of models) ranked.push({ row, model, score: modelScore(model, mode) });
  }
  ranked.sort((a, b) => b.score - a.score);
  const pick = ranked[0];
  if (!pick) throw new Error(`No hay un proveedor externo configurado para ${task}`);
  let apiKey = String(pick.row.api_key || "").trim();
  if (!apiKey && pick.row.builtin_secret) apiKey = String(secrets.get(pick.row.builtin_secret) || "").trim();
  if (!apiKey) throw new Error(`El proveedor ${pick.row.name} no tiene API key`);
  return { name: pick.row.name, endpoint: String(pick.row.endpoint).replace(/\/+$/, "") + "/chat/completions", apiKey, model: pick.model };
}

function validateImages(images: any[]) {
  if (!Array.isArray(images) || !images.length || images.length > MAX_IMAGES) throw new Error("Cantidad de previews no permitida");
  for (const item of images) {
    if (!String(item.preview || "").startsWith("data:image/") || String(item.preview).length > MAX_DATA_URL) throw new Error("Solo se admiten previews JPEG/imagen reducidas");
  }
}

async function vision(base44: any, task: "seleccion" | "ajustes" | "album", mode: "basic" | "pro", prompt: string, images: any[]) {
  validateImages(images);
  const provider = await providerFor(base44, task, mode);
  const content: any[] = [{ type: "text", text: prompt }];
  images.forEach((item) => content.push({ type: "image_url", image_url: { url: item.preview } }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content }], temperature: mode === "pro" ? 0.1 : 0.2, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${provider.name}: HTTP ${response.status}`);
    const body: any = await response.json();
    return { data: parseJson(body?.choices?.[0]?.message?.content), provider: provider.name, model: provider.model };
  } finally {
    clearTimeout(timeout);
  }
}

function selectionPrompt(mode: "basic" | "pro", photos: any[]) {
  return `Selecciona una ráfaga fotográfica con criterio profesional ${mode === "pro" ? "exhaustivo" : "conservador y eficiente"}. Las imágenes corresponden, en orden, a: ${photos.map((p) => p.id).join(", ")}.
Evalúa nitidez del sujeto, foco, exposición, composición y, cuando haya personas, ojos, expresión y momento. REJECT solo ante un defecto claro combinado; ante cualquier duda usa REVIEW. Solo una foto puede ser TOP_PICK.
Responde solo JSON: {"decisions":[{"id":"...","status":"TOP_PICK|SELECT|REVIEW|REJECT","confidence":0,"reason":"...","scores":{"focus":0,"eyes":0,"expression":0,"composition":0,"exposure":0}}]}`;
}

function editPrompt(mode: "basic" | "pro", photos: any[]) {
  return `Decide ajustes básicos no destructivos de Lightroom para ${photos.length} previews, en orden: ${photos.map((p) => p.id).join(", ")}. ${mode === "pro" ? "Analiza cuidadosamente sujeto, piel, luz y balance de color de cada foto." : "Prioriza correcciones seguras, coherentes y moderadas."}
No inventes estilo creativo. Devuelve valores absolutos limitados: Exposure2012 -2..2, Contrast2012 -50..50, Highlights2012 -100..100, Shadows2012 -100..100, Whites2012 -100..100, Blacks2012 -100..100, Temperature -30..30 (delta), Tint -30..30, Vibrance -50..50, Saturation -30..30, Clarity2012 -30..30, Sharpness 0..100. Confianza menor de 70 implica review=true.
Responde solo JSON: {"recipes":[{"id":"...","confidence":0,"review":false,"values":{}}]}`;
}

function albumPrompt(mode: "basic" | "pro", photos: any[]) {
  return `Analiza estas fotos seleccionadas para maquetar un álbum ${mode === "pro" ? "editorial de máxima calidad" : "limpio y equilibrado"}. No recortes ni alteres archivos. Indica importancia, orientación, punto de interés y compatibilidad narrativa. IDs en orden: ${photos.map((p) => p.id).join(", ")}.
Responde solo JSON: {"photos":[{"id":"...","importance":0,"role":"hero|key|support|detail","orientation":"landscape|portrait|square","focal_point":{"x":0.5,"y":0.5}}]}`;
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body: any = await req.json();
    const mode = normalizeMode(body.mode);
    if (body.action === "select") {
      const photos = Array.isArray(body.photos) ? body.photos : [];
      const out = await vision(base44, "seleccion", mode, selectionPrompt(mode, photos), photos);
      return Response.json({ ...out.data, provider: out.provider, model: out.model, mode });
    }
    if (body.action === "edit") {
      const photos = Array.isArray(body.photos) ? body.photos : [];
      const out = await vision(base44, "ajustes", mode, editPrompt(mode, photos), photos);
      return Response.json({ ...out.data, provider: out.provider, model: out.model, mode });
    }
    if (body.action === "album") {
      const photos = Array.isArray(body.photos) ? body.photos : [];
      const out = await vision(base44, "album", mode, albumPrompt(mode, photos), photos);
      return Response.json({ ...out.data, provider: out.provider, model: out.model, mode });
    }
    return Response.json({ error: "Acción V2 desconocida" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
