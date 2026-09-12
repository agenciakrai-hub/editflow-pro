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
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

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
  // Fuerza un modelo EXACTO (lo usa album-engine con el proveedor activo de Álbum).
  // Prevalece sobre el modelo por defecto del proveedor; vacío = modelo por defecto.
  forceModel?: string;
}

// Error tipado para fallos de resolución de modelo (modelo no marcado, no vision-capable
// o sin modelos válidos para la tarea). Se propaga como error EXPLÍCITO y auditable;
// nunca como sustitución silenciosa por otro modelo.
class ModelResolutionError extends Error {
  constructor(msg: string) { super(msg); this.name = "ModelResolutionError"; }
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

// Devuelve el proveedor activo y el MODELO EXACTO configurado para una tarea. El modelo
// exacto (active_model_seleccion/ajustes) es la fuente de verdad del usuario: si está
// fijado, invokeVision NO hace failover (no sustituye el modelo por otro proveedor).
async function getTaskConfig(base44: any, task: AiTask): Promise<{ active: string; exact: string }> {
  const cfg = await getConfig(base44);
  if (!cfg) return { active: "base44", exact: "" };
  const active: any = task === "seleccion" ? cfg.active_seleccion : cfg.active_ajustes;
  const exact: any = task === "seleccion" ? cfg.active_model_seleccion : cfg.active_model_ajustes;
  return {
    active: (typeof active === "string" && active.trim()) ? active.trim() : "base44",
    exact: (typeof exact === "string") ? exact.trim() : "",
  };
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
  // Deslices habituales de los modelos que producen JSON invalido pero sin perder
  // el analisis: numeros con signo "+18" y comas finales ", }".
  let json = txt.slice(start, end + 1)
    .replace(/([:\[,\s])\+(?=\d)/g, "$1")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(json);
  } catch (e: any) {
    throw new Error(`Proveedor: JSON invalido (${String(e?.message || e).slice(0, 120)}) :: ${json.slice(0, 200)}`);
  }
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
  const model = opts.forceModel || cfg?.qwen_model || "qwen3-vl-plus";
  if (opts._trace) opts._trace.model = model;
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
  const model = opts.forceModel || cfg?.nvidia_model || NVIDIA_DEFAULT_MODEL;
  if (opts._trace) opts._trace.model = model;
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
  const model = opts.forceModel || cfg?.gemini_model || GEMINI_DEFAULT_MODEL;
  if (opts._trace) opts._trace.model = model;
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
  if (opts._trace) opts._trace.provider = provider;
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
  if (opts._trace) opts._trace.model = opts.model || "auto";
  console.log(`[aiProvider] task=${opts.task} provider=base44 model=${opts.model || "auto"}`);
  return base44.integrations.Core.InvokeLLM({
    prompt: opts.prompt,
    model: opts.model,
    file_urls: opts.file_urls,
    response_json_schema: opts.response_json_schema,
  });
}

// Cadena de failover: el proveedor activo primero, luego el resto de proveedores
// habilitados (personalizados + integrados). Si el proveedor activo falla, el
// proceso no se detiene: reintenta con el siguiente proveedor configurado.
//
// SELECCIÓN INTELIGENTE: para task="seleccion" NO se incluye base44 (Core.InvokeLLM)
// como ultimo recurso — el failover ocurre SOLO entre proveedores configurados.
// Nunca consume créditos de IA de Base44. Otras tareas (ajustes) conservan base44.
//
// GEMINI EXCLUSIVO: si Gemini es el proveedor activo (seleccion/ajustes), NO hay
// failover — se usa unicamente la nueva API key (GEMINI_API_KEY) con el modelo
// gemini-2.5-flash. Nunca cae a Qwen/NVIDIA/Base44 ni a otras keys.
async function buildFailoverChain(base44: any, active: string, task?: AiTask): Promise<string[]> {
  if (active === "gemini") return ["gemini"];
  const chain: string[] = [];
  const push = (p: string) => { if (p && p !== "none" && !chain.includes(p)) chain.push(p); };
  // Selección Inteligente NUNCA usa Base44 AI (Core.InvokeLLM): se excluye siempre, incluso
  // si quedó como activo (legacy). El fallback tampoco lo incluye.
  if (!(task === "seleccion" && active === "base44")) push(active);
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
  // Base44 AI (Core.InvokeLLM) queda EXCLUIDO de Selección Inteligente: el failover
  // solo ocurre entre proveedores configurados/habilitados. Para otras tareas se
  // conserva como ultimo recurso (sin cambio funcional en ajustes).
  if (task !== "seleccion") push("base44");
  return chain;
}

// Punto unico de ruteo. FAILOVER SOLO ENTRE MODELOS DEL MISMO PROVEEDOR: el proveedor
// activo es el ÚNICO que se intenta. Si el modelo elegido falla (429/500/timeout),
// callCustom reintenta con el siguiente modelo marcado y verificado vision-capable del
// MISMO proveedor — NUNCA salta a otro proveedor. Cada intento se registra en
// opts._trace.attempts (modelo, ok, error, http_status, duración). Si se fuerza un
// proveedor (forceProvider), un único intento sin failover. La traza expone
// proveedor/modelo configurado, intentos por modelo, failover y modelo final.
export async function invokeVision(base44: any, opts: InvokeOpts): Promise<any> {
  if (opts._trace && !Array.isArray(opts._trace.attempts)) opts._trace.attempts = [];
  // Modo forzado (forceProvider): un único intento, sin failover.
  if (opts.forceProvider) {
    const provider = opts.forceProvider;
    if (opts._trace) opts._trace.active_provider = provider;
    const fpIsCustom = typeof provider === "string" && provider.startsWith("custom:");
    const t0 = Date.now();
    try {
      const out = await callProvider(base44, provider, opts);
      if (opts._trace) {
        // callCustom ya registró cada intento de modelo; para proveedores legados se
        // registra aquí el intento único.
        if (!fpIsCustom) {
          opts._trace.attempts.push({ provider, model: opts._trace.model || null, ok: true, http_status: opts._trace.http_status ?? null, latency_ms: Date.now() - t0 });
        }
        opts._trace.failover = opts._trace.attempts.length > 1;
        opts._trace.final_provider = provider;
        opts._trace.final_model = opts._trace.model || null;
      }
      return out;
    } catch (e: any) {
      if (opts._trace && !fpIsCustom) {
        opts._trace.attempts.push({ provider, model: opts._trace.model || null, ok: false, error: String(e?.message || e).slice(0, 300), http_status: e?.httpStatus ?? null, latency_ms: Date.now() - t0 });
      }
      throw e;
    }
  }
  const { active, exact } = await getTaskConfig(base44, opts.task);
  if (opts._trace) { opts._trace.active_provider = active; opts._trace.configured_model = exact || "(auto)"; }
  // REGLA DE FAILOVER: el proveedor activo es el ÚNICO que se intenta. Si el modelo
  // elegido falla (429/500/timeout), callCustom reintenta con OTRO MODELO del MISMO
  // proveedor (failover a nivel de modelo). NUNCA se salta a otro proveedor: el
  // proveedor seleccionado por el administrador es el único que procesa las fotos.
  // Si todos los modelos del proveedor fallan, la tarea falla con error explícito.
  const isCustom = typeof active === "string" && active.startsWith("custom:");
  const t0 = Date.now();
  try {
    const out = await callProvider(base44, active, opts);
    if (opts._trace) {
      // callCustom ya registró cada intento de modelo en attempts; para proveedores
      // legados (qwen/nvidia/gemini/base44) se registra aquí el intento único.
      if (!isCustom) {
        opts._trace.attempts.push({ provider: active, model: opts._trace.model || null, ok: true, http_status: opts._trace.http_status ?? null, latency_ms: Date.now() - t0 });
      }
      opts._trace.failover = opts._trace.attempts.length > 1;
      opts._trace.final_provider = active;
      opts._trace.final_model = opts._trace.model || null;
      opts._trace.failover_reason = null;
    }
    return out;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    if (opts._trace) {
      if (!isCustom) {
        opts._trace.attempts.push({ provider: active, model: opts._trace.model || null, ok: false, error: msg, http_status: e?.httpStatus ?? null, latency_ms: Date.now() - t0 });
      }
      opts._trace.failover = opts._trace.attempts.length > 1;
      opts._trace.final_provider = null;
      opts._trace.final_model = null;
      opts._trace.failover_reason = msg;
    }
    throw e;
  }
}

// Proveedor personalizado (OpenAI-compatible). Lee el registro CustomAiProvider por id y
// lo llama como endpoint /chat/completions con image_url — mismo contrato que Qwen.
// Sirve para seleccion y para ajustes: el motor correspondiente construye el prompt y el
// schema segun la task; el proveedor solo responde. FAILOVER ENTRE MODELOS DEL MISMO
// PROVEEDOR: si el modelo elegido falla, reintenta con el siguiente modelo marcado y
// verificado vision-capable de este proveedor. NUNCA salta a otro proveedor.
async function callCustom(base44: any, customId: string, opts: InvokeOpts): Promise<any> {
  let rec: any = null;
  try {
    rec = await base44.asServiceRole.entities.CustomAiProvider.get(customId);
  } catch {
    throw new Error(`Proveedor personalizado no encontrado: ${customId}`);
  }
  if (!rec) throw new Error(`Proveedor personalizado no encontrado: ${customId}`);
  if (rec.enabled === false) throw new Error(`Proveedor personalizado deshabilitado: ${rec.name}`);
  // Clave propia guardada en el proveedor; si no hay, fallback al secret de Base44
  // (builtin_secret) para los proveedores migrados (Gemini/Qwen/NVIDIA).
  let apiKey = String(rec.api_key || "").trim();
  if (!apiKey && rec.builtin_secret) {
    try { apiKey = String(secrets.get(rec.builtin_secret) || "").trim(); } catch { apiKey = ""; }
  }
  if (!apiKey) throw new Error(`El proveedor "${rec.name}" no tiene API key configurada`);
  const base = String(rec.endpoint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error(`El proveedor "${rec.name}" no tiene endpoint configurado`);
  const endpoint = base + "/chat/completions";
  // Resolución DETERMINISTA del modelo para una tarea de VISIÓN. Reglas (auditable):
  // - Modelo EXACTO (active_model_seleccion/ajustes): debe estar marcado Y verificado
  //   vision-capable (caps.vision === true). Si no está marcado, o está verificado como
  //   NO compatible (false), o NO está verificado (null) → error explícito; NO se
  //   sustituye silenciosamente ni se ejecuta con un modelo no confirmado.
  // - Auto: SOLO entre los marcados verificados vision-capable (true). Si ninguno →
  //   error explícito (exige verificar con "Probar capacidad").
  // NUNCA return models[0] ni heurística de nombre: un modelo de texto o no verificado
  // no puede ejecutarse para visión.
  const taskLabel = opts.task === "ajustes" ? "Ajustes IA" : "Selección IA";
  const markedRaw: any = opts.task === "ajustes" ? rec.ajustes_models : rec.seleccion_models;
  const marked = (Array.isArray(markedRaw) ? markedRaw : [])
    .map((m: any) => String(m || "").trim())
    .filter(Boolean);
  let exactModel = "";
  try {
    const cfg = await getConfig(base44);
    const exactRaw = opts.task === "ajustes" ? cfg?.active_model_ajustes : cfg?.active_model_seleccion;
    exactModel = String(exactRaw || "").trim();
  } catch {}
  // CAPACIDADES desde la fuente única de verdad (available_models_meta, resuelta en
  // ai-providers desde metadatos declarados / prueba empírica). NO se usa el nombre del
  // modelo ni regex. vision: true=compatible, false=verificado NO compatible, null=no
  // verificado. El runtime SOLO permite ejecutar vision=true; false y null se bloquean
  // (null exige verificación previa con "Probar capacidad"; no se sustituye ni se cae
  // a heurísticas de nombre ni a models[0]).
  const metaList: any[] = Array.isArray(rec.available_models_meta) ? rec.available_models_meta : [];
  const capVisionOf = (m: string): boolean | null => {
    const e = metaList.find((x: any) => String(x?.id || "") === m);
    const v = e?.caps?.vision;
    return v === true ? true : v === false ? false : null;
  };
  // CONSTRUCCIÓN DE LA CADENA DE MODELOS (failover DENTRO del mismo proveedor).
  // Si el modelo elegido falla en runtime (HTTP 429/500/timeout), se reintenta con el
  // siguiente modelo marcado y verificado vision-capable del MISMO proveedor. NUNCA se
  // salta a otro proveedor: el proveedor activo es el único responsable.
  //
  // AUTO-DESCUBRIMIENTO: si TODOS los modelos marcados fallan, se intentan automáticamente
  // otros modelos verificados vision-capable del mismo proveedor que NO estén marcados.
  // Si uno de estos tiene éxito, se marca automáticamente para esa herramienta (se añade a
  // seleccion_models / ajustes_models) para que esté disponible la próxima vez que se use
  // ese proveedor con esa herramienta. Si el usuario lo desmarca o cambia manualmente
  // después, ese cambio manual prevalece (la UI sobrescribe la lista completa).
  //
  // Orden: modelo exacto (si está fijado y es válido) → marcados verificados →
  //        auto-descubiertos (no marcados, verificados vision-capable).
  // forceModel (album-engine): modelo forzado por el llamador, sin failover ni auto.
  const trueMarked = marked.filter((m: string) => capVisionOf(m) === true);
  let primaryChain: string[] = [];
  let skipAuto = false;
  if (opts.forceModel) {
    primaryChain = [opts.forceModel];
    skipAuto = true;
  } else if (exactModel) {
    if (!marked.includes(exactModel)) {
      throw new ModelResolutionError(`El modelo exacto "${exactModel}" no está marcado para ${taskLabel} en el proveedor "${rec.name}". Márcalo en Proveedores IA o elige "Auto".`);
    }
    const cv = capVisionOf(exactModel);
    if (cv === false) {
      throw new ModelResolutionError(`El modelo exacto "${exactModel}" está verificado como NO compatible con imágenes (prueba de visión rechazada en Proveedores IA). No puede ejecutar ${taskLabel}. Verifícalo de nuevo o elige otro modelo multimodal.`);
    }
    if (cv === null) {
      throw new ModelResolutionError(`El modelo exacto "${exactModel}" NO está verificado para visión. ${taskLabel} requiere una capacidad confirmada. Pulsa "Probar capacidad" en Proveedores IA para verificarlo antes de ejecutar.`);
    }
    primaryChain = [exactModel, ...trueMarked.filter((m: string) => m !== exactModel)];
  } else {
    primaryChain = trueMarked;
  }
  // Cadena secundaria (auto-descubrimiento): modelos verificados vision-capable del
  // proveedor que NO están marcados para esta tarea. Solo se intentan si la primaria falla.
  const markedSet = new Set(marked);
  const autoChain: string[] = skipAuto ? [] : metaList
    .filter((e: any) => e?.caps?.vision === true && !markedSet.has(String(e?.id || "")))
    .map((e: any) => String(e?.id || ""))
    .filter(Boolean);
  if (!primaryChain.length && !autoChain.length) {
    throw new ModelResolutionError(`"${rec.name}" no tiene modelos marcados ni verificados como compatibles con ${taskLabel}. Marca al menos un modelo en Proveedores IA y pulsa "Probar capacidad" para confirmar su capacidad de visión antes de ejecutar.`);
  }
  if (opts._trace) { opts._trace.configured_model = exactModel || "(auto)"; }
  // Validación PRE-FLIGHT (antes de enviar imágenes): endpoint http/https y presencia de
  // imágenes. La clave, el endpoint no vacío y el modelo vision-capable ya se validaron
  // arriba. Si algo falla aquí, se detecta ANTES de la llamada al proveedor.
  if (!/^https?:\/\/.+/.test(base)) throw new Error(`El proveedor "${rec.name}" no tiene un endpoint válido (debe empezar por http:// o https://)`);
  if (!Array.isArray(opts.file_urls) || !opts.file_urls.filter(Boolean).length) throw new Error(`Sin imágenes que enviar a "${rec.name}" para ${taskLabel}`);
  // Google Gemini (endpoint OpenAI-compat de generativelanguage.googleapis.com) NO acepta
  // imágenes como URL http externa en image_url (HTTP 400 INVALID_ARGUMENT): exige imagen
  // INLINE (data URL base64). Se convierten aquí las URLs http a data URL SOLO para este
  // host. El resto de proveedores (Qwen, NVIDIA, otros custom) no cambian en nada.
  let urls = Array.isArray(opts.file_urls) ? opts.file_urls.filter(Boolean) : [];
  if (/^https?:\/\/generativelanguage\.googleapis\.com\//i.test(endpoint)) {
    const tB64 = Date.now();
    urls = await Promise.all(urls.map(async (u: string) => {
      if (u.startsWith("data:")) return u;
      const r = await fetchWithTimeout(u, { method: "GET" }, 30000);
      if (!r.ok) throw new Error(`[Gemini inline] no se pudo leer la imagen subida (HTTP ${r.status})`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:${r.headers.get("content-type") || "image/jpeg"};base64,${btoa(bin)}`;
    }));
    if (opts._trace) opts._trace.base64_convert_ms = Date.now() - tB64;
  }
  // Intenta cada modelo: primero los marcados (primaryChain), luego los auto-descubiertos
  // (autoChain). Si uno falla (429/500/timeout), reintenta con el siguiente del MISMO
  // proveedor. NUNCA salta a otro proveedor. Si un modelo auto-descubierto tiene éxito, se
  // marca automáticamente para esa herramienta. La traza registra cada intento.
  const fullChain: Array<{ model: string; auto: boolean }> = [
    ...primaryChain.map((m) => ({ model: m, auto: false })),
    ...autoChain.map((m) => ({ model: m, auto: true })),
  ];
  let lastErr: any;
  for (let mi = 0; mi < fullChain.length; mi++) {
    const { model, auto } = fullChain[mi];
    const isLastModel = mi === fullChain.length - 1;
    if (opts._trace) opts._trace.model = model;
    console.log(`[aiProvider] task=${opts.task} provider=${rec.name} model=${model} (${mi + 1}/${fullChain.length})${mi > 0 ? " failover-modelo" : ""}${auto ? " auto-descubierto" : ""}`);
    const content: any[] = [{ type: "text", text: opts.prompt }];
    for (const u of urls) content.push({ type: "image_url", image_url: { url: u } });
    const body: any = { model, messages: [{ role: "user", content }], stream: false };
    // response_format: cuando el llamador pide un JSON schema, se fuerza al modelo a
    // devolver JSON (no texto libre). Sin esto, algunos modelos devuelven texto con
    // bloques de razonamiento que parseJsonContent no puede extraer → valores vacíos.
    if (opts.response_json_schema) {
      body.response_format = { type: "json_object" };
    }
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const latency = Date.now() - t0;
      if (opts._trace) { opts._trace.request_ms = latency; opts._trace.http_status = res.status; opts._trace.endpoint = endpoint; }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const err: any = new Error(`[${rec.name}] HTTP ${res.status} (${latency}ms): ${txt.slice(0, 300)}`);
        err.httpStatus = res.status;
        throw err;
      }
      const data: any = await res.json();
      if (opts._trace) {
        opts._trace.tokens_in = data?.usage?.prompt_tokens ?? null;
        opts._trace.tokens_out = data?.usage?.completion_tokens ?? null;
      }
      const contentOut = data?.choices?.[0]?.message?.content;
      const tParse = Date.now();
      const parsed = parseJsonContent(contentOut);
      if (opts._trace) opts._trace.parse_ms = Date.now() - tParse;
      if (opts._trace) opts._trace.attempts.push({ provider: `custom:${customId}`, model, ok: true, http_status: res.status, latency_ms: latency, auto_discovered: auto });
      // AUTO-DESCUBRIMIENTO: si un modelo no marcado tuvo éxito, se marca automáticamente
      // para esta herramienta en el proveedor. Read-modify-write fresco para no perder
      // otros cambios concurrentes (solo se añade el modelo si no estaba ya presente).
      if (auto) {
        try {
          const fresh: any = await base44.asServiceRole.entities.CustomAiProvider.get(customId);
          const listKey: string = opts.task === "ajustes" ? "ajustes_models" : "seleccion_models";
          const current: string[] = Array.isArray(fresh?.[listKey]) ? fresh[listKey] : [];
          if (!current.includes(model)) {
            await base44.asServiceRole.entities.CustomAiProvider.update(customId, { [listKey]: [...current, model] });
            console.log(`[aiProvider] auto-descubrimiento: "${model}" marcado automaticamente para ${taskLabel} en "${rec.name}"`);
          }
        } catch (persistErr: any) {
          console.log(`[aiProvider] auto-descubrimiento: no se pudo persistir "${model}": ${String(persistErr?.message || persistErr).slice(0, 200)}`);
        }
      }
      return parsed;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      if (opts._trace) opts._trace.attempts.push({ provider: `custom:${customId}`, model, ok: false, error: msg, http_status: e?.httpStatus ?? null, latency_ms: Date.now() - t0, auto_discovered: auto });
      console.log(`[aiProvider] modelo ${model} fallo: ${msg}${isLastModel ? " (sin mas modelos en este proveedor)" : ""}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Todos los modelos de "${rec.name}" fallaron para ${taskLabel}`);
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

// Heuristica para ORDENAR modelos de vision conocidos por calidad. SOLO para
// SUGERENCIAS de la UI (p. ej. detectBestModel). NUNCA se usa para EJECUCION de tareas
// de vision: para ejecucion se usa pickVisionModel, que descarta los no vision-capable.
const VISION_MODEL_PRIORITY = [
  "gpt-4o", "gpt-4-turbo", "gpt-4-vision", "gpt-4o-mini",
  "claude-3-opus", "claude-3.5-sonnet", "claude-3-sonnet", "claude-3-haiku",
  "qwen-vl-max", "qwen2.5-vl", "qwen3-vl", "qwen2-vl",
  "gemini-3", "gemini-2", "gemini-1.5",
  "llava", "vision", "vl", "visual",
];
export function pickBestVisionModel(models: string[]): string {
  const lower = models.map((m) => String(m || "").toLowerCase());
  for (const kw of VISION_MODEL_PRIORITY) {
    const idx = lower.findIndex((m) => m.includes(kw));
    if (idx >= 0) return models[idx];
  }
  return models[0] || "";
}

// ---- Determinacion de capacidad de vision (EJECUCION) ----
// Modelos con soporte CONFIRMADO de entrada de imagen (multimodal). Para tareas de
// vision, Auto SOLO puede elegir modelos que coincidan con estos patrones. Cualquier
// modelo NO listado se considera SOLO DE TEXTO (conservador): no se selecciona para
// vision ni se prueba enviandole imagenes. Esto corrige el bug de seleccionar
// moonshotai/kimi-k3 (texto) para vision: kimi-k3 no coincide con ningun patron.
const VISION_CAPABLE_PATTERNS: RegExp[] = [
  /\bgpt-?4o\b/i, /\bgpt-4-vision\b/i, /\bgpt-4-turbo\b/i, /\bgpt-4o-mini\b/i,
  /\bclaude-3\b/i, /\bclaude-3\.5\b/i, /\bclaude-3\.7\b/i, /\bclaude-sonnet\b/i, /\bclaude-opus\b/i, /\bclaude-haiku\b/i,
  /\bgemini\b/i,
  /\bqwen-?vl\b/i, /\bqwen2\.?-?vl\b/i, /\bqwen3-?vl\b/i, /\bqwen-?vision\b/i, /\bvl-?max\b/i, /\bvl-?plus\b/i, /\bvl-?72b\b/i,
  /\bllava\b/i, /\bpixtral\b/i, /\bminicpm-?v\b/i,
  /\bgemma-?3\b/i, /\bgemma-?3n\b/i, /\bgemma-?4\b/i,
  /\bllama-?3\.2-?vision\b/i, /\bllama-?vision\b/i, /\bphi-?3-?vision\b/i, /\bphi-?4-?multimodal\b/i, /\bphi-?4-?v\b/i,
  /\binternvl\b/i, /\bdeepseek-?vl\b/i, /\bcogvlm\b/i, /\bglm-?4v\b/i,
  /\bvl\b/i, /\bvision\b/i, /\bmultimodal\b/i,
];
// Devuelve true solo si el modelo es reconocido como vision-capable. Desconocido -> false.
export function isVisionModel(model: string): boolean {
  if (!model) return false;
  const m = String(model);
  return VISION_CAPABLE_PATTERNS.some((re) => re.test(m));
}
// Devuelve el mejor modelo vision-capable de la lista, o null si ninguno lo es.
// NUNCA devuelve un modelo de texto (no hay return models[0] peligroso).
export function pickVisionModel(models: string[]): string | null {
  const vision = (Array.isArray(models) ? models : []).filter((m) => isVisionModel(String(m || "")));
  if (!vision.length) return null;
  return pickBestVisionModel(vision) || vision[0];
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
  if (!/^https?:\/\/.+/.test(endpoint)) {
    return { ok: false, reason: "El endpoint no es una URL valida (debe empezar por http:// o https://). No es un email ni un nombre." };
  }
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