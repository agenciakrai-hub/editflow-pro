// AI Provider Adapter — seam de transporte/proveedor. Sustituye UNICAMENTE la capa
// de transporte (InvokeLLM vs HTTP a Qwen). No contiene logica de ranking, prompts,
// schemas, dedup ni concurrencia — todo eso sigue en los motores.
//
// Ruteo: invokeVision({ task, ... }) decide el proveedor activo leyendo AiProviderConfig
// (active_seleccion / active_ajustes). SIN FAILOVER: si el proveedor activo es qwen y
// falla, se lanza error controlado. NUNCA cae a InvokeLLM.
//
// Secret: QWEN_API_KEY se lee via base44:runtime secrets.get(). Solo existe en backend;
// nunca se devuelve al frontend ni se persiste en entidades.

import { secrets } from "base44:runtime";

export type AiTask = "seleccion" | "ajustes";
export type Provider = "qwen" | "base44" | "none";

interface InvokeOpts {
  task: AiTask;
  prompt: string;
  model?: string;
  file_urls?: string[];
  response_json_schema?: any;
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

export async function activeProviderFor(base44: any, task: AiTask): Promise<Provider> {
  const cfg = await getConfig(base44);
  if (!cfg) return "base44";
  const field: any = task === "seleccion" ? cfg.active_seleccion : cfg.active_ajustes;
  if (field === "qwen" || field === "base44" || field === "none") return field;
  return "base44";
}

// Parse robusto del JSON que devuelve Qwen (string en choices[0].message.content).
// Quita fences ```json ... ``` y extrae el primer objeto { ... }.
function parseJsonContent(content: any): any {
  if (content && typeof content === "object") return content;
  if (typeof content !== "string") throw new Error("Qwen: respuesta sin contenido parseable");
  let txt = content.trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Qwen: no se encontro JSON en la respuesta");
  }
  return JSON.parse(txt.slice(start, end + 1));
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
  const res = await fetch(endpoint, {
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

// Punto unico de ruteo. SIN FAILOVER.
export async function invokeVision(base44: any, opts: InvokeOpts): Promise<any> {
  const provider = await activeProviderFor(base44, opts.task);
  if (provider === "qwen") {
    const cfg = await getConfig(base44);
    console.log(`[aiProvider] task=${opts.task} provider=qwen model=${cfg?.qwen_model || "qwen3-vl-plus"}`);
    return callQwen(cfg, opts);
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
    const res = await fetch(endpoint, {
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

export function isQwenKeyPresent(): boolean {
  try {
    return !!secrets.get("QWEN_API_KEY");
  } catch {
    return false;
  }
}