// AI Provider Adapter — seam de transporte/proveedor. Sustituye UNICAMENTE la capa
// de transporte (InvokeLLM vs HTTP a Qwen/NVIDIA). No contiene logica de ranking,
// prompts, schemas, dedup ni concurrencia — todo eso sigue en los motores.
//
// Ruteo: invokeVision({ task, ... }) decide el proveedor activo leyendo AiProviderConfig
// (active_seleccion / active_ajustes). SIN FAILOVER: si el proveedor activo falla, se
// lanza error controlado. NUNCA cae a InvokeLLM ni a otro proveedor.
//
// Proveedores:
//   - base44 : InvokeLLM (integracion Base44). Requiere UploadFile para generar file_urls.
//   - qwen   : HTTP OpenAI-compatible a DashScope. file_urls http (via UploadFile).
//   - nvidia : HTTP OpenAI-compatible a NVIDIA NIM (minimaxai/minimax-m3). Recibe file_urls
//              que pueden ser data:image/jpeg;base64,... (el motor evita UploadFile para
//              esta ruta) o URLs http. Mismo contrato de salida que qwen/base44.
//
// Secret: QWEN_API_KEY y NVIDIA_API_KEY se leen via base44:runtime secrets.get(). Solo
// existen en backend; nunca se devuelven al frontend ni se persisten en entidades.

import { secrets } from "base44:runtime";

export type AiTask = "seleccion" | "ajustes";
export type Provider = "qwen" | "base44" | "nvidia" | "gemini" | "none";

const NVIDIA_DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1";
const NVIDIA_DEFAULT_MODEL = "minimaxai/minimax-m3";
const GEMINI_DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_MODEL = "gemini-3.6-flash";

interface InvokeOpts {
  task: AiTask;
  prompt: string;
  model?: string;
  file_urls?: string[];
  response_json_schema?: any;
  _trace?: any;
  // Fuerza un proveedor concreto ignorando active_seleccion/active_ajustes. Lo usa el
  // motor de revelado IA visual (Qwen) para garantizar Qwen sin depender de la config.
  forceProvider?: Provider;
}

// Lee el unico registro de configuracion (admin-only entity, accedido via service role).
async function getConfig(base44: any): Promise<any> {
  try {
    const list = await base44.asServiceRole.entities.AiProviderConfig.list();
    return Array.isArray(list) && list.length ? list[0] : null;
  } catch {
    return null;
  }
}

export async function activeProviderFor(base44: any, task: AiTask): Promise<string> {
  const cfg = await getConfig(base44);
  if (!cfg) return "base44";
  const field: any = task === "seleccion" ? cfg.active_seleccion : cfg.active_ajustes;
  if (typeof field === "string" && field.trim()) return field.trim();
  return "base44";
}

// Parse robusto del JSON que devuelve el modelo (string en choices[0].message.content).
// Quita fences ```json ... ``` y extrae el primer objeto { ... }.
function parseJsonContent(content: any): any {
  if (content && typeof content === "object") return content;
  if (typeof content !== "string") throw new Error("Proveedor: respuesta sin contenido parseable");
  let txt = content.trim();
  // Modelos de razonamiento (MiniMax M3, DeepSeek-R1...) emiten bloques <think>...</think>
  // antes del JSON final. Si no se eliminan, el primer '{' cae dentro del razonamiento y
  // JSON.parse falla -> el motor de ajustes se queda sin valores (XMP solo con preset,
  // sin correcciones basicas).
  txt = txt.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Proveedor: no se encontro JSON en la respuesta");
  }
  return JSON.parse(txt.slice(start, end + 1));
}

// fetch con timeout: evita que una llamada de proveedor colgada (sin respuesta) bloquee
// indefinidamente el pipeline. Si supera el límite, aborta y lanza → el motor captura el
// error y aplica el fallback técnico. No afecta a llamadas legítimas lentas dentro del
// límite (120s es generoso para visión con varias imágenes).
const PROVIDER_TIMEOUT_MS = 120000;
async function fetchWithTimeout(url: string, opts: any, ms: number = PROVIDER_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e: any) {
    if (controller.signal.aborted) throw new Error(`Proveedor: timeout tras ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callQwen(cfg: any, opts: InvokeOpts): Promise<any> {
  const apiKey = secrets.get("QWEN_API_KEY");
  if (!apiKey) {
    throw new Error("QWEN_API_KEY no configurado (introúcelo en Base44 → Settings → Secrets)");
  }
  const base = String(cfg?.qwen_endpoint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("qwen_endpoint no configurado");
  const endpoint = base + "/chat/completions";
  const model = cfg?.qwen_model || "qwen3-vl-plus";
  const urls = Array.isArray(opts.file_urls) ? opts.file_urls.filter(Boolean) : [];

  const content: any[] = [{ type: "text", text: opts.prompt }];
  for (const u of urls) content.push({ type: "image_url", image_url: { url: u } });

  const body = { model, messages: [{ role: "user", content }], stream: false };
  const t0 = Date.now();
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Qwen HTTP ${res.status} (${latency}ms): ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const contentOut = data?.choices?.[0]?.message?.content;
  return parseJsonContent(contentOut);
}

// NVIDIA NIM (OpenAI-compatible). Recibe file_urls que pueden ser data URLs
// (data:image/jpeg;base64,...) — el motor evita UploadFile para esta ruta — o URLs http.
// Mismo contrato de salida que Qwen (JSON parseado). SIN FAILOVER.
async function callNvidia(cfg: any, opts: InvokeOpts): Promise<any> {
  const apiKey = secrets.get("NVIDIA_API_KEY");
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY no configurado (introúcelo en Base44 → Settings → Secrets)");
  }
  const base = String(cfg?.nvidia_endpoint || NVIDIA_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  if (!base) throw new Error("nvidia_endpoint no configurado");
  const endpoint = base + "/chat/completions";
  const model = cfg?.nvidia_model || NVIDIA_DEFAULT_MODEL;
  const urls = Array.isArray(opts.file_urls) ? opts.file_urls.filter(Boolean) : [];

  const content: any[] = [{ type: "text", text: opts.prompt }];
  for (const u of urls) content.push({ type: "image_url", image_url: { url: u } });

  const body = {
    model,
    messages: [{ role: "user", content }],
    stream: false,
    max_tokens: 8192,
    temperature: 1,
    top_p: 0.95,
  };
  const t0 = Date.now();
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`NVIDIA HTTP ${res.status} (${latency}ms): ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const contentOut = data?.choices?.[0]?.message?.content;
  // TRAZA TEMPORAL: captura la respuesta cruda del modelo (post-reasoning) para diagnostico.
  if (opts._trace) {
    opts._trace.rawContent = contentOut;
    opts._trace.httpStatus = res.status;
  }
  const parsed = parseJsonContent(contentOut);
  if (opts._trace) {
    opts._trace.parsed = parsed;
  }
  return parsed;
}

// Llamada unica a Gemini con una key concreta. Devuelve el JSON parseado o lanza un
// error tipado con httpStatus para que el orquestador decida el fallback a la capa de pago.
async function callGeminiOnce(apiKey: string, cfg: any, opts: InvokeOpts): Promise<any> {
  const base = String(cfg?.gemini_endpoint || GEMINI_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  const model = cfg?.gemini_model || GEMINI_DEFAULT_MODEL;
  const endpoint = `${base}/models/${model}:generateContent?key=${apiKey}`;
  const urls = Array.isArray(opts.file_urls) ? opts.file_urls.filter(Boolean) : [];

  const parts: any[] = [{ text: opts.prompt }];
  for (const u of urls) {
    const dataMatch = /^data:([^;]+);base64,(.*)$/is.exec(u);
    if (dataMatch) {
      parts.push({ inline_data: { mime_type: dataMatch[1], data: dataMatch[2] } });
    } else {
      parts.push({ file_data: { file_uri: u, mime_type: "image/jpeg" } });
    }
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json" },
  };
  const t0 = Date.now();
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err: any = new Error(`Gemini HTTP ${res.status} (${latency}ms): ${txt.slice(0, 300)}`);
    err.httpStatus = res.status;
    throw err;
  }
  const data: any = await res.json();
  const contentOut = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") || "";
  return parseJsonContent(contentOut);
}

// Google Gemini. Usa únicamente GEMINI_API_KEY (la key del usuario). SIN failover: si
// Gemini falla (cuota, rate-limit, error HTTP), se lanza el error tal cual — nunca
// reintenta con otra key, nunca cae a Qwen ni a InvokeLLM. El proveedor activo es el
// único responsable. GEMINI_API_KEY_PAID no se toca en esta ruta.
async function callGemini(cfg: any, opts: InvokeOpts): Promise<any> {
  const apiKey = secrets.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("Gemini falló: GEMINI_API_KEY no configurado (introúcelo en Base44 → Settings → Secrets)");
  }
  // Reintento SOLO en errores transitorios del proveedor (503 high-demand / 429 rate-limit),
  // misma key y mismo modelo — NO es failover a otro proveedor (respeta el aislamiento de
  // Gemini). Google recomienda reintentar estos estados. Sin reintento en 400/404
  // (errores definitivos: imagen inválida, modelo deprecated).
  const transient = new Set([429, 503]);
  const maxAttempts = 3;
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callGeminiOnce(apiKey, cfg, opts);
    } catch (e: any) {
      lastErr = e;
      if (!transient.has(e.httpStatus) || attempt === maxAttempts) throw e;
      const backoffMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s
      console.log(`[aiProvider] gemini ${e.httpStatus} transitorio, reintentando en ${backoffMs}ms (intento ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// Punto unico de ruteo. SIN FAILOVER.
// Despacha a un proveedor concreto. Sin failover (lo gestiona invokeVision).
async function callProvider(base44: any, provider: string, opts: InvokeOpts): Promise<any> {
  if (typeof provider === "string" && provider.startsWith("custom:")) {
    const id = provider.slice("custom:".length);
    console.log(`[aiProvider] task=${opts.task} provider=custom:${id}`);
    return callCustom(base44, id, opts);
  }
  if (provider === "qwen") {
    const cfg = await getConfig(base44);
    console.log(`[aiProvider] task=${opts.task} provider=qwen model=${cfg?.qwen_model || "qwen3-vl-plus"}`);
    return callQwen(cfg, opts);
  }
  if (provider === "gemini") {
    const cfg = await getConfig(base44);
    console.log(`[aiProvider] task=${opts.task} provider=gemini model=${cfg?.gemini_model || GEMINI_DEFAULT_MODEL}`);
    return callGemini(cfg, opts);
  }
  if (provider === "nvidia") {
    const cfg = await getConfig(base44);
    console.log(`[aiProvider] task=${opts.task} provider=nvidia model=${cfg?.nvidia_model || NVIDIA_DEFAULT_MODEL} via_upload_file=false`);
    return callNvidia(cfg, opts);
  }
  if (provider === "none") {
    throw new Error(`No hay proveedor configurado para task=${opts.task} (active=none)`);
  }
  // base44 (por defecto y retrocompatible)
  console.log(`[aiProvider] task=${opts.task} provider=base44 model=${opts.model || "auto"}`);
  return base44.integrations.Core.InvokeLLM({
    prompt: opts.prompt,
    model: opts.model,
    file_urls: opts.file_urls,
    response_json_schema: opts.response_json_schema,
  });
}

// Cadena de failover: el proveedor activo primero, luego el resto de proveedores
// habilitados (personalizados + integrados), y base44 como ultimo recurso. Si el
// proveedor activo falla, el proceso no se detiene: reintenta con el siguiente.
async function buildFailoverChain(base44: any, active: string): Promise<string[]> {
  const chain: string[] = [];
  const push = (p: string) => { if (p && p !== "none" && !chain.includes(p)) chain.push(p); };
  push(active);
  try {
    const customs = await base44.asServiceRole.entities.CustomAiProvider.list();
    for (const c of (Array.isArray(customs) ? customs : [])) {
      if (c.enabled !== false) push(`custom:${c.id}`);
    }
  } catch {}
  const cfg = await getConfig(base44);
  if (cfg) {
    if (cfg.qwen_enabled) push("qwen");
    if (cfg.gemini_enabled) push("gemini");
    if (cfg.nvidia_enabled) push("nvidia");
  }
  push("base44"); // ultimo recurso: siempre disponible
  return chain;
}

// Punto unico de ruteo. CON FAILOVER: si el proveedor activo falla, reintenta con el
// siguiente proveedor habilitado de la cadena. Si se fuerza un proveedor
// (forceProvider), no hay failover (comportamiento original garantizado).
export async function invokeVision(base44: any, opts: InvokeOpts): Promise<any> {
  if (opts.forceProvider) {
    return callProvider(base44, opts.forceProvider, opts);
  }
  const active = await activeProviderFor(base44, opts.task);
  const chain = await buildFailoverChain(base44, active);
  let lastErr: any;
  for (const provider of chain) {
    try {
      return await callProvider(base44, provider, opts);
    } catch (e: any) {
      console.log(`[aiProvider] failover: provider=${provider} fallo: ${e?.message || e}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Todos los proveedores fallaron para task=${opts.task}`);
}

// Proveedor personalizado (OpenAI-compatible). Lee el registro CustomAiProvider por id y
// lo llama como endpoint /chat/completions con image_url — mismo contrato que Qwen.
// Sirve para seleccion y para ajustes: el motor correspondiente construye el prompt y el
// schema segun la task; el proveedor solo responde. SIN FAILOVER.
async function callCustom(base44: any, customId: string, opts: InvokeOpts): Promise<any> {
  let rec: any = null;
  try {
    rec = await base44.asServiceRole.entities.CustomAiProvider.get(customId);
  } catch {
    throw new Error(`Proveedor personalizado no encontrado: ${customId}`);
  }
  if (!rec) throw new Error(`Proveedor personalizado no encontrado: ${customId}`);
  if (rec.enabled === false) throw new Error(`Proveedor personalizado deshabilitado: ${rec.name}`);
  const apiKey = String(rec.api_key || "");
  if (!apiKey) throw new Error(`El proveedor "${rec.name}" no tiene API key configurada`);
  const base = String(rec.endpoint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error(`El proveedor "${rec.name}" no tiene endpoint configurado`);
  const endpoint = base + "/chat/completions";
  const model = String(rec.model || "").trim();
  if (!model) throw new Error(`El proveedor "${rec.name}" no tiene modelo configurado`);
  const urls = Array.isArray(opts.file_urls) ? opts.file_urls.filter(Boolean) : [];
  const content: any[] = [{ type: "text", text: opts.prompt }];
  for (const u of urls) content.push({ type: "image_url", image_url: { url: u } });
  const body = { model, messages: [{ role: "user", content }], stream: false };
  const t0 = Date.now();
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`[${rec.name}] HTTP ${res.status} (${latency}ms): ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const contentOut = data?.choices?.[0]?.message?.content;
  return parseJsonContent(contentOut);
}

// Ping minimo a un proveedor personalizado (OpenAI-compatible). Acepta credenciales sueltas
// (para probar antes de guardar) o el id de un proveedor ya almacenado. NUNCA devuelve la API Key.
export async function testCustomConnection(base44: any, creds: { endpoint?: string; model?: string; api_key?: string; id?: string }): Promise<any> {
  let endpoint = "", model = "", apiKey = "", name = "custom";
  if (creds.id) {
    const rec = await base44.asServiceRole.entities.CustomAiProvider.get(creds.id).catch(() => null);
    if (!rec) return { provider: "custom", ok: false, reason: "Proveedor no encontrado", key_present: false, via_invoke_llm: false };
    endpoint = String(rec.endpoint || "").trim().replace(/\/+$/, "") + "/chat/completions";
    model = String(rec.model || "").trim();
    apiKey = String(rec.api_key || "");
    name = rec.name || "custom";
  } else {
    const base = String(creds.endpoint || "").trim().replace(/\/+$/, "");
    endpoint = base ? base + "/chat/completions" : "";
    model = String(creds.model || "").trim();
    apiKey = String(creds.api_key || "");
  }
  if (!apiKey) return { provider: "custom", ok: false, reason: "API key requerida", key_present: false, model, endpoint, via_invoke_llm: false };
  if (!endpoint) return { provider: "custom", ok: false, reason: "Endpoint requerido", key_present: true, model, endpoint: "", via_invoke_llm: false };
  if (!model) return { provider: "custom", ok: false, reason: "Modelo requerido", key_present: true, model: "", endpoint, via_invoke_llm: false };
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }], stream: false, max_tokens: 8 }),
    });
    const latency = Date.now() - t0;
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    return { provider: "custom", name, model, endpoint, http_status: res.status, latency_ms: latency, ok: res.ok, key_present: true, via_invoke_llm: false, response_preview: bodyText.slice(0, 200) };
  } catch (e: any) {
    return { provider: "custom", name, model, endpoint, ok: false, reason: e.message, latency_ms: Date.now() - t0, key_present: true, via_invoke_llm: false };
  }
}

// Heuristica para elegir el mejor modelo de vision de un proveedor OpenAI-compatible que
// expone muchos modelos (OpenRouter, OpenAI, etc.). Prioriza modelos conocidos por su
// calidad en vision; si ninguno coincide, devuelve el primero disponible.
const VISION_MODEL_PRIORITY = [
  "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "gpt-4o-mini",
  "claude-3-opus", "claude-3.5-sonnet", "claude-3-sonnet", "claude-3-haiku",
  "qwen-vl-max", "qwen2.5-vl", "qwen3-vl", "qwen2-vl",
  "gemini-2", "gemini-1.5",
  "llava", "vision", "vl", "visual", "image",
];
export function pickBestVisionModel(models: string[]): string {
  const lower = models.map((m) => String(m || "").toLowerCase());
  for (const kw of VISION_MODEL_PRIORITY) {
    const idx = lower.findIndex((m) => m.includes(kw));
    if (idx >= 0) return models[idx];
  }
  return models[0] || "";
}

// Detecta el mejor modelo de vision de un proveedor consultando su endpoint /models.
// Acepta credenciales sueltas (para probar antes de guardar) o el id de un proveedor
// almacenado. NUNCA devuelve la API Key.
export async function detectBestModel(base44: any, creds: { endpoint?: string; api_key?: string; id?: string }): Promise<any> {
  let endpoint = "", apiKey = "";
  if (creds.id) {
    const rec = await base44.asServiceRole.entities.CustomAiProvider.get(creds.id).catch(() => null);
    if (!rec) return { ok: false, reason: "Proveedor no encontrado" };
    endpoint = String(rec.endpoint || "").trim().replace(/\/+$/, "");
    apiKey = String(rec.api_key || "");
  } else {
    endpoint = String(creds.endpoint || "").trim().replace(/\/+$/, "");
    apiKey = String(creds.api_key || "");
  }
  if (!endpoint) return { ok: false, reason: "Endpoint requerido" };
  if (!apiKey) return { ok: false, reason: "API key requerida" };
  const url = endpoint + "/models";
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, 30000);
    const latency = Date.now() - t0;
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}: ${bodyText.slice(0, 200)}`, endpoint: url, latency_ms: latency };
    const data = JSON.parse(bodyText);
    const models = (data?.data || data?.models || []).map((m: any) => m.id || m.name || "").filter(Boolean);
    if (!models.length) return { ok: false, reason: "El proveedor no devolvio modelos", endpoint: url, latency_ms: latency };
    const best = pickBestVisionModel(models);
    return { ok: true, model: best, total: models.length, endpoint: url, latency_ms: latency };
  } catch (e: any) {
    return { ok: false, reason: e.message, endpoint: url, latency_ms: Date.now() - t0 };
  }
}

// Ping minimo a Qwen (sin fotos). Devuelve trazabilidad. NUNCA devuelve la API Key.
export async function testConnection(base44: any): Promise<any> {
  const cfg = await getConfig(base44);
  const apiKey = secrets.get("QWEN_API_KEY");
  const keyPresent = !!apiKey;
  const base = String(cfg?.qwen_endpoint || "").trim().replace(/\/+$/, "");
  const endpoint = base ? base + "/chat/completions" : "";
  const model = cfg?.qwen_model || "qwen3-vl-plus";

  if (!keyPresent) {
    return { provider: "qwen", ok: false, reason: "QWEN_API_KEY no configurado", key_present: false, model, endpoint, via_invoke_llm: false };
  }
  if (!base) {
    return { provider: "qwen", ok: false, reason: "qwen_endpoint no configurado", key_present: true, model, endpoint: "", via_invoke_llm: false };
  }

  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        stream: false,
      }),
    });
    const latency = Date.now() - t0;
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    return {
      provider: "qwen",
      model,
      endpoint,
      http_status: res.status,
      latency_ms: latency,
      ok: res.ok,
      key_present: true,
      via_invoke_llm: false,
      response_preview: bodyText.slice(0, 200),
    };
  } catch (e: any) {
    return { provider: "qwen", model, endpoint, ok: false, reason: e.message, latency_ms: Date.now() - t0, key_present: true, via_invoke_llm: false };
  }
}

// Ping minimo a NVIDIA (sin fotos). Devuelve trazabilidad. NUNCA devuelve la API Key.
export async function testNvidiaConnection(base44: any): Promise<any> {
  const cfg = await getConfig(base44);
  const apiKey = secrets.get("NVIDIA_API_KEY");
  const keyPresent = !!apiKey;
  const base = String(cfg?.nvidia_endpoint || NVIDIA_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  const endpoint = base + "/chat/completions";
  const model = cfg?.nvidia_model || NVIDIA_DEFAULT_MODEL;

  if (!keyPresent) {
    return { provider: "nvidia", ok: false, reason: "NVIDIA_API_KEY no configurado", key_present: false, model, endpoint, via_invoke_llm: false };
  }

  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        stream: false,
        max_tokens: 8,
      }),
    });
    const latency = Date.now() - t0;
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    return {
      provider: "nvidia",
      model,
      endpoint,
      http_status: res.status,
      latency_ms: latency,
      ok: res.ok,
      key_present: true,
      via_invoke_llm: false,
      response_preview: bodyText.slice(0, 200),
    };
  } catch (e: any) {
    return { provider: "nvidia", model, endpoint, ok: false, reason: e.message, latency_ms: Date.now() - t0, key_present: true, via_invoke_llm: false };
  }
}

// Prueba minima de vision NVIDIA: envia 1 preview base64 como data URL directamente
// al endpoint OpenAI-compatible de NVIDIA. NO usa UploadFile ni InvokeLLM. Devuelve
// el contenido textual que produce el modelo para confirmar que la imagen llega.
export async function testNvidiaVision(base44: any, previewBase64: string): Promise<any> {
  const cfg = await getConfig(base44);
  const apiKey = secrets.get("NVIDIA_API_KEY");
  const base = String(cfg?.nvidia_endpoint || NVIDIA_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  const endpoint = base + "/chat/completions";
  const model = cfg?.nvidia_model || NVIDIA_DEFAULT_MODEL;

  if (!apiKey) {
    return { provider: "nvidia", ok: false, reason: "NVIDIA_API_KEY no configurado", key_present: false, model, endpoint, via_invoke_llm: false, via_upload_file: false };
  }
  if (!previewBase64) {
    return { provider: "nvidia", ok: false, reason: "preview_base64 requerido", key_present: true, model, endpoint, via_invoke_llm: false, via_upload_file: false };
  }

  const dataUrl = `data:image/jpeg;base64,${previewBase64}`;
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [
          { type: "text", text: "Describe this image in one short sentence." },
          { type: "image_url", image_url: { url: dataUrl } },
        ] }],
        stream: false,
        max_tokens: 256,
      }),
    });
    const latency = Date.now() - t0;
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    let contentPreview = "";
    if (res.ok) {
      try {
        const data = JSON.parse(bodyText);
        contentPreview = String(data?.choices?.[0]?.message?.content || "").slice(0, 300);
      } catch {
        contentPreview = bodyText.slice(0, 300);
      }
    }
    return {
      provider: "nvidia",
      model,
      endpoint,
      http_status: res.status,
      latency_ms: latency,
      ok: res.ok,
      key_present: true,
      via_invoke_llm: false,
      via_upload_file: false,
      content_preview: contentPreview,
      response_preview: bodyText.slice(0, 200),
    };
  } catch (e: any) {
    return { provider: "nvidia", model, endpoint, ok: false, reason: e.message, latency_ms: Date.now() - t0, key_present: true, via_invoke_llm: false, via_upload_file: false };
  }
}

export function isQwenKeyPresent(): boolean {
  try {
    return !!secrets.get("QWEN_API_KEY");
  } catch {
    return false;
  }
}

export function isNvidiaKeyPresent(): boolean {
  try {
    return !!secrets.get("NVIDIA_API_KEY");
  } catch {
    return false;
  }
}

// Ping minimo a Gemini (sin fotos). Devuelve trazabilidad. NUNCA devuelve la API Key.
export async function testGeminiConnection(base44: any): Promise<any> {
  const cfg = await getConfig(base44);
  const apiKey = secrets.get("GEMINI_API_KEY");
  const keyPresent = !!apiKey;
  const base = String(cfg?.gemini_endpoint || GEMINI_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  const model = cfg?.gemini_model || GEMINI_DEFAULT_MODEL;
  const endpointPath = `${base}/models/${model}:generateContent`;

  if (!keyPresent) {
    return { provider: "gemini", ok: false, reason: "GEMINI_API_KEY no configurado", key_present: false, model, endpoint: endpointPath, via_invoke_llm: false };
  }

  const t0 = Date.now();
  try {
    const res = await fetch(`${endpointPath}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { responseMimeType: "text/plain" },
      }),
    });
    const latency = Date.now() - t0;
    let bodyText = "";
    try { bodyText = await res.text(); } catch {}
    return {
      provider: "gemini",
      model,
      endpoint: endpointPath,
      http_status: res.status,
      latency_ms: latency,
      ok: res.ok,
      key_present: true,
      via_invoke_llm: false,
      response_preview: bodyText.slice(0, 200),
    };
  } catch (e: any) {
    return { provider: "gemini", model, endpoint: endpointPath, ok: false, reason: e.message, latency_ms: Date.now() - t0, key_present: true, via_invoke_llm: false };
  }
}

export function isGeminiKeyPresent(): boolean {
  try {
    return !!secrets.get("GEMINI_API_KEY");
  } catch {
    return false;
  }
}