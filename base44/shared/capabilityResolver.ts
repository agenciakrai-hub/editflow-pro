// capabilityResolver — Orquesta la detección AUTOMÁTICA de capacidades (cadena A→B→C).
//
// A: metadatos declarados por el propio proveedor en GET /models (buildModelsMeta).
// B: cross-reference con el catálogo PÚBLICO de OpenRouter (que declara modalidades
//    para sus 443 modelos). Cubre modelos compartidos entre proveedores.
// C: sondeo empírico automático: envía una imagen de prueba mínima al modelo vía el
//    endpoint del propio proveedor. Solo para modelos que siguen sin clasificar.
//
// REGLAS:
//   - No usa regex sobre el nombre del modelo. No usa models[0].
//   - No requiere acción manual del usuario (el sondeo es automático en add/retest).
//   - Los modelos ya clasificados (true/false) NO se vuelven a sondear en retest.
//   - Errores transitorios (429/500/502/503/timeout/red) → null (no false).
//   - Solo vision=false cuando hay evidencia real de rechazo de imagen (400/422/415).
//   - Fuente única de verdad: available_models_meta (persistido en CustomAiProvider).

import { buildModelsMeta, resolveDeclaredCaps, ModelMetaEntry } from "./modelCapabilities.ts";
import { runWithConcurrency } from "./concurrency.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 20000;

// Imagen de prueba mínima (1x1 PNG). Suficiente para detectar si el modelo ACEPTA
// entrada de imagen: 200+texto → vision=true; 400 citando image → vision=false.
const TEST_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0N8AAAAASUVORK5CYII=";

// ---------------- Nivel B: cross-reference OpenRouter ----------------

let _orCache: { at: number; models: any[] } | null = null;
const OR_CACHE_TTL_MS = 3600_000; // 1h

async function fetchOpenRouterCatalog(): Promise<any[]> {
  if (_orCache && Date.now() - _orCache.at < OR_CACHE_TTL_MS) return _orCache.models;
  try {
    const r = await fetch(OPENROUTER_MODELS_URL, { headers: { "Content-Type": "application/json" } });
    if (!r.ok) return _orCache?.models || [];
    const data = await r.json();
    const models = data?.data || [];
    _orCache = { at: Date.now(), models };
    return models;
  } catch {
    return _orCache?.models || [];
  }
}

// Normaliza un ID de modelo para matching cross-provider: lowercase, quita ~, :free,
// :batch, :nitro, :preview y prefijo models/. NO usa regex sobre el nombre para
// clasificar — solo para buscarlo en el catálogo de OpenRouter por ID exacto.
function normId(id: string): string {
  return String(id || "")
    .toLowerCase()
    .replace(/^~/, "")
    .replace(/:(free|batch|nitro|preview)$/i, "")
    .replace(/^models\//, "")
    .trim();
}

// Para cada modelo con vision=null, busca en OpenRouter por ID normalizado (match
// exacto o por nombre corto). Si OpenRouter declara su modalidad, aplica esas caps.
// Devuelve un NUEVO metaList; los ya clasificados (A) no se tocan.
export async function crossRefOpenRouter(metaList: ModelMetaEntry[]): Promise<ModelMetaEntry[]> {
  const orModels = await fetchOpenRouterCatalog();
  if (!orModels.length) return metaList;
  const byNorm = new Map<string, any>();
  const byShort = new Map<string, any>();
  for (const m of orModels) {
    const n = normId(m.id);
    if (n && !byNorm.has(n)) byNorm.set(n, m);
    const short = n.split("/").pop();
    if (short && short.length > 4 && !byShort.has(short)) byShort.set(short, m);
  }
  return metaList.map((entry) => {
    if (entry.caps.vision !== null) return entry; // A ya clasificó
    const n = normId(entry.id);
    const short = n.split("/").pop();
    const orModel = byNorm.get(n) || (short && short.length > 4 ? byShort.get(short) : null);
    if (!orModel) return entry;
    const caps = resolveDeclaredCaps(orModel);
    if (caps.vision === null) return entry; // OpenRouter tampoco declaró
    return { ...entry, caps, source: "declared-crossref" as const };
  });
}

// ---------------- Nivel C: sondeo empírico automático ----------------

async function probeOne(
  endpoint: string,
  apiKey: string,
  model: string
): Promise<{ vision: boolean | null; status: string; reason: string }> {
  const content = [
    { type: "text", text: "Describe this image in one short sentence." },
    { type: "image_url", image_url: { url: TEST_IMAGE_DATA_URL } },
  ];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content }], stream: false, max_tokens: 16 }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const txt = await res.text().catch(() => "");
    if (res.ok) {
      let data: any = null;
      try { data = JSON.parse(txt); } catch {}
      const out = String(data?.choices?.[0]?.message?.content || "").trim();
      if (out) return { vision: true, status: "ok", reason: `OK: ${out.slice(0, 80)}` };
      return { vision: null, status: "error", reason: "Respuesta vacía del modelo" };
    }
    const low = txt.toLowerCase();
    // Solo vision=false cuando hay evidencia REAL de que el modelo NO acepta imágenes.
    // Errores transitorios (429/500/502/503/timeout/red) → null (no false).
    const rejectsImage =
      (res.status === 400 || res.status === 422 || res.status === 415) &&
      /image|vision|multimodal|not support|unsupported|modal|does not|no admite|no acepta|image_url/.test(low);
    if (rejectsImage) return { vision: false, status: "rejected", reason: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
    return { vision: null, status: "error", reason: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
  } catch (e: any) {
    return { vision: null, status: "error", reason: String(e?.message || e).slice(0, 120) };
  }
}

// Sondea automáticamente los modelos con vision=null. Preserva true/false existentes
// (no los re-sondea). Devuelve nuevo meta con resultados (source="verified").
export async function probeVisionAutomatic(
  metaList: ModelMetaEntry[],
  endpoint: string,
  apiKey: string
): Promise<ModelMetaEntry[]> {
  const toProbe = metaList.filter((e) => e.caps.vision === null);
  if (!toProbe.length) return metaList;
  const chatEndpoint = endpoint.replace(/\/+$/, "") + "/chat/completions";
  const results = new Map<string, { vision: boolean | null; status: string; reason: string }>();
  await runWithConcurrency(toProbe, PROBE_CONCURRENCY, async (entry: ModelMetaEntry) => {
    const r = await probeOne(chatEndpoint, apiKey, entry.id);
    results.set(entry.id, r);
  });
  const now = new Date().toISOString();
  return metaList.map((entry) => {
    if (entry.caps.vision !== null) return entry; // ya clasificado, no re-sondea
    const r = results.get(entry.id);
    if (!r) return entry;
    return {
      ...entry,
      caps: { ...entry.caps, vision: r.vision },
      source: r.vision === null ? "unverified" : "verified",
      probed_at: now,
      probe_status: r.status as any,
    };
  });
}

// ---------------- Orquestador A→B→C ----------------

// Resuelve capacidades de TODOS los modelos de un proveedor:
//   A) buildModelsMeta (metadatos declarados del proveedor).
//   B) crossRefOpenRouter (catálogo público de OpenRouter).
//   C) probeVisionAutomatic (sondeo empírico de los que siguen null).
//
// Preserva true/false de prevMeta (no re-sondea clasificados), salvo forceReprobe.
// rawModels: objetos crudos de GET /models del proveedor.
// prevMeta: meta anterior (para conservar clasificaciones verificadas).
// endpoint/apiKey: del proveedor (para sondeo C).
// opts.skipProbe: true → omite C (para list/ensureBuiltinRows, rápido).
// opts.forceReprobe: true → ignora prevMeta y re-sondea todo (reclasificación forzada).
export async function resolveCapabilitiesFull(
  rawModels: any[],
  prevMeta: ModelMetaEntry[] | undefined,
  endpoint: string,
  apiKey: string,
  opts: { skipProbe?: boolean; forceReprobe?: boolean } = {}
): Promise<ModelMetaEntry[]> {
  // A: metadatos declarados por el proveedor (fresh, autoritativo).
  let meta = buildModelsMeta(rawModels);
  // Preservar true/false de prevMeta (no re-sondea clasificados), salvo force.
  if (prevMeta && !opts.forceReprobe) {
    const prevById = new Map(prevMeta.map((m) => [m.id, m]));
    meta = meta.map((entry) => {
      if (entry.caps.vision !== null) return entry; // A declaró fresh → usar
      const p = prevById.get(entry.id);
      if (p && p.caps.vision !== null) {
        // Conservar clasificación previa (cross-ref o sondeo) para no re-sondear.
        return {
          ...entry,
          caps: { ...entry.caps, vision: p.caps.vision },
          source: p.source,
          probed_at: p.probed_at,
          probe_status: p.probe_status,
        };
      }
      return entry; // sigue null → B/C lo resolverán
    });
  }
  // B: cross-reference OpenRouter (solo vision=null).
  meta = await crossRefOpenRouter(meta);
  // C: sondeo empírico (solo vision=null restantes), a menos que skipProbe.
  if (!opts.skipProbe && apiKey) {
    meta = await probeVisionAutomatic(meta, endpoint, apiKey);
  }
  return meta;
}