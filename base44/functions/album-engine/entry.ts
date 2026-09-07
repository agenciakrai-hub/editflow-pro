// ALBUM-ENGINE — Fase 4.1. Función EXCLUSIVA de EditFlow Album AI, aislada por diseño
// (Fase 4.0/4.0.1 aprobadas): no toca editflow-engine, ni active_seleccion, ni el
// failover del Core, ni Lightroom. Es un proxy SIN ESTADO por lote: recibe previews
// sanitizadas como data URLs inline, las procesa en memoria y devuelve JSON; NUNCA
// persiste imágenes ni usa UploadFile (regla de privacidad Fase 4.0.1).
//
// Proveedores (Fase 4.0.1):
//   - gemini_paid : transporte AISLADO propio (~60 líneas autorizadas) que usa
//                   EXCLUSIVAMENTE GEMINI_API_KEY_PAID (tier de pago: no entrena con
//                   datos). La key gratuita (GEMINI_API_KEY) queda EXCLUIDA de Album AI.
//   - qwen        : seam compartido invokeVision({forceProvider:"qwen"}) en SOLO LECTURA
//                   (data URLs inline, verificado en docs oficiales DashScope — sin UploadFile).
//   - nvidia      : mismo seam con forceProvider:"nvidia" (data URLs inline, verificado).
//   - base44      : EXCLUIDO (InvokeLLM requiere UploadFile + almacenamiento sin TTL).
//
// Cadena de failover PROPIA de Album AI: gemini_paid -> qwen -> nvidia. Respeta la
// configuración del usuario (AlbumAIConfig.allowed_providers) y la REVOCACIÓN de
// consentimiento. De la config admin del Core solo LEE endpoint/modelo (read-only).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from "base44:runtime";
import { invokeVision } from "../../shared/aiProviderAdapter.ts";

const GEMINI_DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
const CHAIN = ["gemini_paid", "qwen", "nvidia"];
const PROVIDER_TIMEOUT_MS = 120000;
const MAX_IMAGES = 24;
const MAX_B64_CHARS = 700000; // ~500 KB decodificados por imagen (toque duro Fase 4.0.1)

function json(status, body) {
  return Response.json(body, { status });
}

async function fetchWithTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`timeout tras ${ms || PROVIDER_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Parse robusto (misma técnica probada del seam compartido): limpia bloques de
// razonamiento y fences, extrae el primer objeto {...}.
function parseJsonLoose(content) {
  if (content && typeof content === "object") return content;
  if (typeof content !== "string") throw new Error("respuesta sin contenido parseable");
  let t = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error("sin JSON en la respuesta");
  return JSON.parse(t.slice(s, e + 1));
}

// Config de plataforma SOLO LECTURA (endpoint/modelo; Fase 4.0.1: la política de
// proveedores y la cadena son del módulo, el endpoint/modelo es del administrador).
async function getPlatformConfig(base44) {
  try {
    const list = await base44.asServiceRole.entities.AiProviderConfig.list();
    return Array.isArray(list) && list.length ? list[0] : null;
  } catch {
    return null;
  }
}

// Cadena del usuario (Bloque 3): respeta allowed_providers y la REVOCACIÓN de
// consentimiento. Solo se aplica a acciones con fotos del usuario (E4-E7).
async function userChain(base44) {
  try {
    const list = await base44.entities.AlbumAIConfig.list();
    const cfg = Array.isArray(list) && list.length ? list[0] : null;
    if (cfg?.revoked) {
      throw new Error("consent_revoked: consentimiento revocado; concede uno nuevo antes de iniciar un análisis remoto");
    }
    if (Array.isArray(cfg?.allowed_providers) && cfg.allowed_providers.length) {
      const filtered = CHAIN.filter((p) => cfg.allowed_providers.includes(p));
      if (filtered.length) return filtered;
    }
  } catch (e) {
    if (String(e?.message || "").includes("consent_revoked")) throw e;
  }
  return CHAIN;
}

function assertImageDataUrls(urls, action) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (list.length > MAX_IMAGES) {
    throw new Error(`${action}: máximo ${MAX_IMAGES} imágenes por lote`);
  }
  for (const u of list) {
    if (typeof u !== "string" || !/^data:image\/[a-z+]+;base64,/i.test(u)) {
      throw new Error(`${action}: solo se aceptan data URLs de imagen (aislamiento: sin UploadFile ni URLs http)`);
    }
    if (u.length > MAX_B64_CHARS) {
      throw new Error(`${action}: imagen supera el tope de tamaño (${Math.round(u.length * 0.75 / 1024)} KB)`);
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
// TRANSPORTE AISLADO — GEMINI DE PAGO (Fase 4.0.1, autorizado ~60 líneas).
// Usa EXCLUSIVAMENTE GEMINI_API_KEY_PAID (tier de pago: Google no usa los datos
// para mejorar productos). NUNCA la key gratuita. Nunca UploadFile: inline_data.
// ---------------------------------------------------------------------------
async function callGeminiPaidOnce(apiKey, cfg, prompt, fileUrls) {
  const base = String(cfg?.gemini_endpoint || GEMINI_DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  const model = cfg?.gemini_model || GEMINI_DEFAULT_MODEL;
  const parts = [{ text: prompt }];
  for (const u of fileUrls) {
    const m = /^data:([^;]+);base64,(.*)$/is.exec(u);
    if (!m) throw new Error("gemini_paid: solo data URLs inline");
    parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const res = await fetchWithTimeout(`${base}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`gemini_paid HTTP ${res.status}: ${txt.slice(0, 200)}`);
    err.httpStatus = res.status;
    throw err;
  }
  const data = await res.json();
  const contentOut = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("") || "";
  return parseJsonLoose(contentOut);
}

async function callGeminiPaid(base44, prompt, fileUrls) {
  // Nueva API key única: prefiere la key de pago aislada de Album AI y, si no está
  // seteada, usa la nueva key general (GEMINI_API_KEY) — siempre gemini-2.5-flash.
  const apiKey = secrets.get("GEMINI_API_KEY_PAID") || secrets.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("gemini_paid: no hay API key de Gemini configurada (GEMINI_API_KEY_PAID ni GEMINI_API_KEY)");
  const cfg = await getPlatformConfig(base44);
  const transient = new Set([429, 503]);
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callGeminiPaidOnce(apiKey, cfg, prompt, fileUrls);
    } catch (e) {
      lastErr = e;
      if (!transient.has(e.httpStatus) || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// CADENA DE FAILOVER PROPIA (Bloque 7). skip solo lo usa providers-test para
// SIMULAR caídas (Checkpoint 7). Cada eslabón registra su fallo; el pipeline
// del cliente decide reintentos por lote.
// ---------------------------------------------------------------------------
async function invokeAlbumVision(base44, action, prompt, fileUrls, skip, useUserConfig) {
  const errors = [];
  const chain = useUserConfig ? await userChain(base44) : CHAIN;
  for (const provider of chain) {
    if (skip && skip.includes(provider)) {
      errors.push({ provider, skipped: true });
      continue;
    }
    const t0 = Date.now();
    try {
      let result;
      let model = "";
      if (provider === "gemini_paid") {
        result = await callGeminiPaid(base44, prompt, fileUrls);
        const cfg = await getPlatformConfig(base44);
        model = cfg?.gemini_model || GEMINI_DEFAULT_MODEL;
      } else {
        // Qwen / NVIDIA por el seam compartido en SOLO LECTURA. task es irrelevante
        // en ruta forzada (forceProvider): solo transporte, sin failover del Core.
        result = await invokeVision(base44, { task: "seleccion", prompt, file_urls: fileUrls, forceProvider: provider });
        const cfg = await getPlatformConfig(base44);
        model = provider === "qwen" ? (cfg?.qwen_model || "qwen3-vl-plus") : (cfg?.nvidia_model || "minimaxai/minimax-m3");
      }
      return { result, provider, model, latency_ms: Date.now() - t0 };
    } catch (e) {
      console.log(`[album-engine] ${action} provider=${provider} fallo: ${e?.message || e}`);
      errors.push({ provider, error: String(e?.message || e) });
    }
  }
  throw new Error(`album-engine ${action}: todos los proveedores fallaron: ${JSON.stringify(errors)}`);
}

// ---------------------------------------------------------------------------
// PROMPTS (E4–E7) — selección profesional. La IA SOLO analiza/recomienda/explica;
// jamás elimina fotos ni toca spreads.
// ---------------------------------------------------------------------------
function e4Prompt(eventType, batch) {
  return `Eres el asistente de selección fotográfica de un fotógrafo profesional de ${eventType}. Analiza CADA foto (identificada por su alias, en el orden dado). Valora:
- technical (0-100): nitidez real del sujeto, exposición, ruido, defectos graves (desenfoque, trepidación). Usa la métrica local como apoyo, no como verdad absoluta.
- aesthetic (0-100): composición, luz, color, impacto visual.
- people (0-100 o null si no hay personas): calidad de expresiones, miradas, emoción, ojos cerrados/abiertos.
- confidence (0-100): cuánta seguridad tienes en tu valoración.
- reasons: 1-2 frases cortas en español, concretas y útiles para el fotógrafo.
Responde SOLO JSON válido, sin texto extra:
{"analyses":[{"alias":"...","dims":{"technical":0,"aesthetic":0,"people":0},"confidence":0,"reasons":"..."}]}
Fotos: ${batch.map((p) => `${p.alias} (métrica local: ${JSON.stringify(p.local_tech || {})})`).join(" | ")}`;
}

function e5Prompt(eventType, group, kind) {
  return `Eres el asistente de selección fotográfica de un fotógrafo profesional de ${eventType}. Este es un ${kind === "burst" ? "grupo de ráfaga (disparos casi idénticos)" : "grupo/secuencia temporal"} de un mismo momento. Elige la MEJOR foto del grupo (promoted) considerando emoción, expresiones, miradas cerradas, nitidez del sujeto principal e instante decisivo — no solo la métrica técnica.
Para cada foto da: dims {technical, aesthetic, people}, group_rank (1 = mejor), reasons (1-2 frases en español).
Responde SOLO JSON válido:
{"promoted":"alias","per_photo":[{"alias":"...","dims":{"technical":0,"aesthetic":0,"people":0},"group_rank":1,"reasons":"..."}],"group_summary":"1 frase sobre este momento"}
Fotos: ${group.map((p) => `${p.alias} (local: ${JSON.stringify(p.local_tech || {})}) (E4: ${JSON.stringify(p.e4_summary || {})})`).join(" | ")}`;
}

function e6Prompt(eventType, reps) {
  return `Eres el asistente narrativo de un fotógrafo profesional de ${eventType}. Recibirás las fotos representativas (una por momento/escena) del reportaje, en orden temporal. Agrúpalas en MOMENTOS narrativos del álbum (ej. preparativos, detalles, ceremonia, retratos, fiesta). Cada momento: name (corto, en español), archetype, order (1..N), summary (1-2 frases), aliases (las fotos que lo forman).
Responde SOLO JSON válido:
{"moments":[{"name":"...","archetype":"...","order":1,"summary":"...","aliases":["a1","a2"]}]}
Representativas: ${reps.map((r) => `${r.alias} (${r.group_kind})`).join(" | ")}`;
}

function e7Prompt(eventType, target, descriptors, forced, blocked) {
  return `Eres el asistente de selección final de un fotógrafo profesional de ${eventType}. Conforma la SELECCIÓN final del álbum con los descriptores de fotos pre-aprobadas (ya filtradas por grupos y momentos). Objetivo aproximado: ${target.total} fotos (${target.per_spread} por doble página, ~${target.spreads} dobles).
Reglas del fotógrafo (JERARQUÍA MÁXIMA): INCLUIR SIEMPRE: ${forced.length ? forced.join(", ") : "(ninguna)"}. EXCLUIR SIEMPRE: ${blocked.length ? blocked.join(", ") : "(ninguna)"}.
Asigna a cada seleccionada: role (hero | key | support | detail), moment, category, reasons (frase concreta para el fotógrafo), tech_exception (true si la eliges pese a métrica técnica inferior por su valor único/emotivo).
Asegura cobertura de todos los momentos. Responde SOLO JSON válido:
{"selection":[{"alias":"...","role":"...","moment":"...","category":"...","reasons":"...","tech_exception":false}],"funnel_report":{"total_input":0,"selected":0,"coverage":"...","notes":"..."},"coverage":"resumen breve"}
Descriptores: ${descriptors.map((d) => `${d.alias}: ${d.phrase}`).join(" | ")}`;
}

// ---------------------------------------------------------------------------
// ACCIONES
// ---------------------------------------------------------------------------
async function actionProvidersTest(base44, body) {
  // Diagnóstico de transporte (Checkpoints 4-7). Acepta una imagen de prueba como
  // data_url (p. ej. sintética generada en el navegador) o como public_image_url
  // (imagen pública de prueba); NUNCA fotografías privadas en los checkpoints.
  let testImage = body.data_url || null;
  if (!testImage && body.public_image_url) {
    const res = await fetchWithTimeout(body.public_image_url, {}, 30000);
    if (!res.ok) throw new Error(`descarga de imagen de prueba HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    const mime = (res.headers.get("content-type") || "image/png").split(";")[0];
    testImage = `data:${mime};base64,${btoa(bin)}`;
  }
  const skip = Array.isArray(body.skip) ? body.skip : [];
  if (body.chain_mode) {
    // Checkpoint 7: ejecuta la CADENA completa (skip = simulación de caída) y
    // reporta qué proveedor sirvió la petición y qué eslabones se simularon caídos.
    const t0 = Date.now();
    const prompt = testImage
      ? 'Prueba de failover. Responde SOLO JSON: {"ok":true,"description":"una frase"}'
      : 'Prueba de failover sin imagen. Responde SOLO JSON: {"ok":true,"description":"texto"}';
    const out = await invokeAlbumVision(base44, "providers-test", prompt, testImage ? [testImage] : [], skip);
    return json(200, {
      action: "providers-test",
      chain_mode: true,
      skipped: skip,
      served_by: out.provider,
      model: out.model,
      latency_ms: Date.now() - t0,
      description: String(out.result?.description || "").slice(0, 200),
    });
  }
  const results = [];
  for (const provider of CHAIN) {
    if (skip.includes(provider)) {
      results.push({ provider, ok: false, skipped: true, reason: "simulado no disponible (checkpoint failover)" });
      continue;
    }
    const t0 = Date.now();
    try {
      const prompt = testImage
        ? 'Prueba de transporte. ¿Qué ves en la imagen? Responde SOLO JSON: {"ok":true,"description":"una frase"}'
        : 'Prueba de transporte sin imagen. Responde SOLO JSON: {"ok":true,"description":"texto"}';
      const fileUrls = testImage ? [testImage] : [];
      // Aísla CADA proveedor (los demás simulados como caídos) para que el failover
      // no enmascare el diagnóstico individual.
      const skipOthers = CHAIN.filter((p) => p !== provider);
      const out = await invokeAlbumVision(base44, "providers-test", prompt, fileUrls, skipOthers);
      results.push({
        provider,
        ok: true,
        model: out.model,
        latency_ms: Date.now() - t0,
        via_upload_file: false,
        description: String(out.result?.description || "").slice(0, 200),
      });
    } catch (e) {
      results.push({ provider, ok: false, reason: String(e?.message || e).slice(0, 300), via_upload_file: false });
    }
  }
  return json(200, {
    action: "providers-test",
    results,
    base44_excluded: "InvokeLLM excluido de Album AI (requiere UploadFile + almacenamiento sin TTL)",
    gemini_free_excluded: "tier gratuito excluido (condiciones de uso de datos)",
  });
}

async function actionE4(base44, body) {
  const batch = Array.isArray(body.batch) ? body.batch : [];
  if (!batch.length || batch.length > MAX_IMAGES) throw new Error("e4-triage: lote de 1-20 fotos requerido");
  assertImageDataUrls(batch.map((p) => p.thumb), "e4-triage");
  const aliases = batch.map((p) => p.alias);
  const out = await invokeAlbumVision(base44, "e4-triage", e4Prompt(body.event_type || "boda", batch), batch.map((p) => p.thumb), body.skip, true);
  const byAlias = new Map((out.result?.analyses || []).map((a) => [a.alias, a]));
  const analyses = aliases.map((alias) => byAlias.get(alias) || { alias, dims: null, confidence: 0, reasons: "sin análisis (proveedor no devolvió esta foto)" });
  return json(200, { action: "e4-triage", analyses, provider: out.provider, model: out.model, latency_ms: out.latency_ms });
}

async function actionE5(base44, body) {
  const group = Array.isArray(body.group) ? body.group : [];
  if (!group.length || group.length > 12) throw new Error("e5-group: grupo de 2-12 fotos requerido (grupos mayores se dividen en sub-lotes)");
  assertImageDataUrls(group.map((p) => p.thumb), "e5-group");
  const out = await invokeAlbumVision(base44, "e5-group", e5Prompt(body.event_type || "boda", group, body.group_kind || "burst"), group.map((p) => p.thumb), body.skip, true);
  const perPhoto = out.result?.per_photo || [];
  let promoted = out.result?.promoted || (perPhoto.length ? perPhoto.slice().sort((a, b) => (a.group_rank || 99) - (b.group_rank || 99))[0]?.alias : null);
  if (!promoted || !group.some((p) => p.alias === promoted)) promoted = group[0].alias;
  return json(200, { action: "e5-group", promoted, per_photo: perPhoto, group_summary: String(out.result?.group_summary || ""), provider: out.provider, model: out.model, latency_ms: out.latency_ms });
}

async function actionE6(base44, body) {
  const reps = Array.isArray(body.representatives) ? body.representatives : [];
  if (!reps.length || reps.length > 24) throw new Error("e6-moments: 1-24 representantes requeridos");
  assertImageDataUrls(reps.map((p) => p.thumb), "e6-moments");
  const out = await invokeAlbumVision(base44, "e6-moments", e6Prompt(body.event_type || "boda", reps), reps.map((p) => p.thumb), body.skip, true);
  const moments = Array.isArray(out.result?.moments) ? out.result.moments : [];
  return json(200, { action: "e6-moments", moments, provider: out.provider, model: out.model, latency_ms: out.latency_ms });
}

async function actionE7(base44, body) {
  const descriptors = Array.isArray(body.descriptors) ? body.descriptors : [];
  if (!descriptors.length) throw new Error("e7-assembly: descriptores requeridos");
  const forced = Array.isArray(body.forced) ? body.forced : [];
  const blocked = Array.isArray(body.blocked) ? body.blocked : [];
  const target = body.album_target || { total: 60, per_spread: 3, spreads: 20 };
  // SOLO TEXTO: E7 no envía ninguna imagen (coste mínimo, privacidad máxima).
  const out = await invokeAlbumVision(base44, "e7-assembly", e7Prompt(body.event_type || "boda", target, descriptors, forced, blocked), [], body.skip, true);
  const selection = Array.isArray(out.result?.selection) ? out.result.selection : [];
  const valid = new Set(descriptors.map((d) => d.alias));
  return json(200, {
    action: "e7-assembly",
    selection: selection.filter((s) => valid.has(s.alias)),
    funnel_report: out.result?.funnel_report || {},
    coverage: String(out.result?.coverage || ""),
    provider: out.provider,
    model: out.model,
    latency_ms: out.latency_ms,
  });
}

// ---------------------------------------------------------------------------
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return json(401, { error: "Unauthorized" });
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    console.log(`[album-engine] user=${user.id} action=${action}`);

    // Consentimiento OBLIGATORIO para cualquier acción que envíe fotos del usuario.
    if (action === "providers-test") return await actionProvidersTest(base44, body);
    if (body?.consent !== true) {
      return json(400, { error: "consent_required", stage: action, message: "El análisis remoto requiere consentimiento explícito del fotógrafo." });
    }
    if (action === "e4-triage") return await actionE4(base44, body);
    if (action === "e5-group") return await actionE5(base44, body);
    if (action === "e6-moments") return await actionE6(base44, body);
    if (action === "e7-assembly") return await actionE7(base44, body);
    return json(400, { error: "unknown_action", action: action || null });
  } catch (error) {
    console.log(`[album-engine] ERROR: ${error?.message || error}`);
    return json(500, { error: String(error?.message || error), retriable: true });
  }
}