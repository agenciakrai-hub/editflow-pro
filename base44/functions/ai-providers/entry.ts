import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import {
  testConnection,
  testNvidiaConnection,
  testNvidiaVision,
  testGeminiConnection,
  isQwenKeyPresent,
  isNvidiaKeyPresent,
  isGeminiKeyPresent,
  pickBestVisionModel,
} from '../../shared/aiProviderAdapter.ts';
import { resolveCapabilitiesFull } from '../../shared/capabilityResolver.ts';

// Proveedores IA — admin-only. UNA SOLA herramienta de proveedores: se añade un
// proveedor con endpoint + API key, la función autodetecta el nombre (dominio), normaliza
// la URL base (añade /v1 si falta ruta), verifica la conexión con GET {endpoint}/models
// y guarda en available_models TODOS los modelos detectados. El administrador marca en
// la página qué modelos sirven para Selección IA y cuáles para Ajustes IA; los motores
// usan exclusivamente esa lista marcada (seleccion_models / ajustes_models).
//
// Acciones:
//   - get-config / save-config / test-connection : proveedores integrados (secrets de Base44)
//   - list / add / update-models / retest / toggle / delete : proveedores propios
//
// NUNCA devuelve las API keys (solo una versión enmascarada).

const NVIDIA_DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL = 'minimaxai/minimax-m3';
const GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const MODELS_PAGE_LIMIT = 500;

// Normaliza la URL base: valida http(s), quita slashes finales y añade /v1 cuando solo
// se introduce el dominio (https://openrouter.ai -> https://openrouter.ai/v1).
function normalizeEndpoint(raw: string): string {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new Error('El endpoint debe ser una URL válida que empiece por http:// o https:// (ej. https://openrouter.ai). No es un email ni un nombre.');
  }
  const u = new URL(url);
  if (!u.pathname || u.pathname === '/') return `${u.protocol}//${u.host}/v1`;
  return url;
}

// Nombre amigable autodetectado del dominio (openrouter.ai -> Openrouter).
function nameFromDomain(endpoint: string): string {
  try {
    if (new URL(endpoint).hostname === 'generativelanguage.googleapis.com') return 'Google Gemini';
    const host = new URL(endpoint).hostname.replace(/^www\./, '');
    const base = host.split('.')[0] || 'Proveedor';
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'Proveedor';
  }
}

// Verifica la conexión y lista TODOS los modelos del proveedor (GET {endpoint}/models).
// Devuelve también los objetos CRUDOS (raw) para que buildModelsMeta resuelva las
// capacidades declaradas (OpenRouter architecture.modality, OpenAI modalities, NVIDIA
// capabilities.inference cuando el deployment las declare).
async function fetchModels(
  endpoint: string,
  apiKey: string
): Promise<{ ok: boolean; models: string[]; raw: any[]; reason: string; http_status: number | null; latency_ms: number }> {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let res: Response;
    try {
      res = await fetch(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, models: [], raw: [], reason: `HTTP ${res.status}: ${bodyText.slice(0, 200)}`, http_status: res.status, latency_ms: Date.now() - t0 };
    }
    const data = JSON.parse(bodyText);
    const raw = (data?.data || data?.models || []).slice(0, MODELS_PAGE_LIMIT);
    const models = raw.map((m: any) => String(m?.id || m?.name || '').trim()).filter(Boolean);
    if (!models.length) {
      return { ok: false, models: [], raw: [], reason: 'El proveedor no devolvió modelos en GET /models', http_status: res.status, latency_ms: Date.now() - t0 };
    }
    return { ok: true, models, raw, reason: '', http_status: res.status, latency_ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, models: [], raw: [], reason: String(e?.message || e), http_status: null, latency_ms: Date.now() - t0 };
  }
}

// La reconstrucción de available_models_meta (preservando true/false y re-sondeando
// solo null/nuevos) la orquesta resolveCapabilitiesFull (cadena A→B→C) en
// base44/shared/capabilityResolver.ts. Esta función ya no se necesita aquí.

function maskKey(key: string): string {
  if (!key) return '';
  return key.length <= 8 ? '••••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// Clave efectiva de un proveedor: la guardada en la fila (api_key) y, si no hay,
// el secret de Base44 (builtin_secret) para los proveedores migrados.
function effectiveKey(rec: any): string {
  const own = String(rec?.api_key || '').trim();
  if (own) return own;
  if (rec?.builtin_secret) {
    try { return String(secrets.get(rec.builtin_secret) || '').trim(); } catch { return ''; }
  }
  return '';
}

// Proveedores integrados migrados a filas normales (lista unificada): Gemini, Qwen y
// NVIDIA nacen como CustomAiProvider la primera vez que se abre la herramienta, con
// la clave tomada del secret de Base44 (builtin_secret). Al cambiar la clave desde la
// página, esta se guarda en la fila y pasa a usarse esa. La migración ocurre UNA sola
// vez (builtin_migrated): si el administrador borra una fila, no se recrea.
const BUILTIN_DEFS: Array<{ key: string; name: string; host: string; endpoint: string; model: string; legacy: string }> = [
  { key: 'GEMINI_API_KEY', name: 'Google Gemini', host: 'generativelanguage.googleapis.com', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', legacy: 'gemini' },
  { key: 'QWEN_API_KEY', name: 'Qwen — DashScope', host: 'dashscope', endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus', legacy: 'qwen' },
  { key: 'NVIDIA_API_KEY', name: 'NVIDIA NIM', host: 'integrate.api.nvidia.com', endpoint: 'https://integrate.api.nvidia.com/v1', model: 'minimaxai/minimax-m3', legacy: 'nvidia' },
];

async function ensureBuiltinRows(base44: any) {
  const cfg = await getConfigRecord(base44);
  if (cfg?.builtin_migrated) return;
  const activePatch: any = {};
  try {
    const existing = await base44.asServiceRole.entities.CustomAiProvider.list(200);
    const rows = Array.isArray(existing) ? existing : [];
    for (const def of BUILTIN_DEFS) {
      // Ya existe una fila para este proveedor (p. ej. añadida manualmente): no duplicar,
      // pero se remapean las referencias legadas a esa fila existente.
      const existingRow = rows.find((r: any) => String(r?.endpoint || '').includes(def.host));
      if (existingRow) {
        if (cfg?.active_seleccion === def.legacy) activePatch.active_seleccion = `custom:${existingRow.id}`;
        if (cfg?.active_ajustes === def.legacy) activePatch.active_ajustes = `custom:${existingRow.id}`;
        continue;
      }
      let key = '';
      try { key = String(secrets.get(def.key) || '').trim(); } catch {}
      if (!key) continue;
      let endpoint = def.endpoint;
      if (def.legacy === 'qwen' && cfg?.qwen_endpoint) endpoint = normalizeEndpoint(cfg.qwen_endpoint);
      if (def.legacy === 'nvidia' && cfg?.nvidia_endpoint) endpoint = normalizeEndpoint(cfg.nvidia_endpoint);
      const check = await fetchModels(endpoint, key).catch(() => null);
      const models = check?.ok ? check.models.map((m: string) => m.replace(/^models\//, '')) : [def.model];
      const rawModels = check?.ok ? check.raw.map((m: any) => ({ ...m, id: String(m?.id || m?.name || '').replace(/^models\//, '') })) : [];
      const meta = check?.ok ? await resolveCapabilitiesFull(rawModels, undefined, endpoint, key, { skipProbe: true }) : [];
      const marks = [models.includes(def.model) ? def.model : models[0]];
      const rec: any = await base44.asServiceRole.entities.CustomAiProvider.create({
        name: def.name,
        endpoint,
        api_key: '',
        builtin_secret: def.key,
        available_models: models,
        available_models_meta: meta,
        seleccion_models: marks,
        ajustes_models: marks,
        model: def.model,
        enabled: true,
        last_ok: !!check?.ok,
        last_reason: check?.ok ? '' : String(check?.reason || ''),
        last_checked: new Date().toISOString(),
      });
      // Remap de referencias legadas ("qwen"/"gemini"/"nvidia") a la fila unificada.
      if (cfg?.active_seleccion === def.legacy) activePatch.active_seleccion = `custom:${rec.id}`;
      if (cfg?.active_ajustes === def.legacy) activePatch.active_ajustes = `custom:${rec.id}`;
    }
    if (cfg) {
      await base44.asServiceRole.entities.AiProviderConfig.update(cfg.id, { ...activePatch, builtin_migrated: true });
    } else {
      await base44.asServiceRole.entities.AiProviderConfig.create({
        active_seleccion: activePatch.active_seleccion || 'base44',
        active_ajustes: activePatch.active_ajustes || 'base44',
        builtin_migrated: true,
      });
    }
  } catch (e: any) {
    console.log(`[ai-providers] migracion integrados fallo: ${e?.message || e}`);
  }
}

// Nunca expone la API key: solo versión enmascarada.
function maskProvider(r: any) {
  return {
    id: r.id,
    name: r.name,
    endpoint: r.endpoint,
    available_models: Array.isArray(r.available_models) ? r.available_models : [],
    available_models_meta: Array.isArray(r.available_models_meta) ? r.available_models_meta : [],
    seleccion_models: Array.isArray(r.seleccion_models) ? r.seleccion_models : [],
    ajustes_models: Array.isArray(r.ajustes_models) ? r.ajustes_models : [],
    edicion_models: Array.isArray(r.edicion_models) ? r.edicion_models : [],
    video_models: Array.isArray(r.video_models) ? r.video_models : [],
    album_models: Array.isArray(r.album_models) ? r.album_models : [],
    model: r.model || '',
    enabled: r.enabled !== false,
    last_ok: !!r.last_ok,
    last_reason: r.last_reason || '',
    last_checked: r.last_checked || '',
    builtin_secret: r.builtin_secret || '',
    masked_key: maskKey(effectiveKey(r)),
    has_key: !!effectiveKey(r),
    has_own_key: !!r.api_key,
  };
}

async function getConfigRecord(base44: any) {
  const list = await base44.asServiceRole.entities.AiProviderConfig.list();
  return Array.isArray(list) && list.length ? list[0] : null;
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    console.log(`[ai-providers] user=${user.id} action=${action}`);

    // ------------------------------------------------------------------
    // Proveedores integrados (Qwen, NVIDIA, Gemini) — secrets de Base44.
    // ------------------------------------------------------------------
    if (action === 'get-config') {
      const cfg = await getConfigRecord(base44);
      return Response.json({
        config: cfg,
        qwen_key_present: isQwenKeyPresent(),
        nvidia_key_present: isNvidiaKeyPresent(),
        gemini_key_present: isGeminiKeyPresent(),
      });
    }

    if (action === 'save-config') {
      const patch = {
        qwen_enabled: !!body.qwen_enabled,
        qwen_endpoint: typeof body.qwen_endpoint === 'string' ? body.qwen_endpoint.trim() : '',
        qwen_model: typeof body.qwen_model === 'string' && body.qwen_model.trim() ? body.qwen_model.trim() : 'qwen3-vl-plus',
        nvidia_enabled: body.nvidia_enabled !== false,
        nvidia_endpoint: typeof body.nvidia_endpoint === 'string' && body.nvidia_endpoint.trim() ? body.nvidia_endpoint.trim() : NVIDIA_DEFAULT_ENDPOINT,
        nvidia_model: typeof body.nvidia_model === 'string' && body.nvidia_model.trim() ? body.nvidia_model.trim() : NVIDIA_DEFAULT_MODEL,
        gemini_enabled: body.gemini_enabled !== false,
        gemini_endpoint: typeof body.gemini_endpoint === 'string' && body.gemini_endpoint.trim() ? body.gemini_endpoint.trim() : GEMINI_DEFAULT_ENDPOINT,
        gemini_model: typeof body.gemini_model === 'string' && body.gemini_model.trim() ? body.gemini_model.trim() : GEMINI_DEFAULT_MODEL,
        base44_enabled: body.base44_enabled !== false,
        active_seleccion: typeof body.active_seleccion === 'string' && body.active_seleccion.trim() ? body.active_seleccion.trim() : 'base44',
        active_ajustes: typeof body.active_ajustes === 'string' && body.active_ajustes.trim() ? body.active_ajustes.trim() : 'base44',
      };
      const existing = await getConfigRecord(base44);
      let cfg;
      if (existing) {
        cfg = await base44.asServiceRole.entities.AiProviderConfig.update(existing.id, patch);
      } else {
        cfg = await base44.asServiceRole.entities.AiProviderConfig.create(patch);
      }
      return Response.json({
        config: cfg,
        qwen_key_present: isQwenKeyPresent(),
        nvidia_key_present: isNvidiaKeyPresent(),
        gemini_key_present: isGeminiKeyPresent(),
      });
    }

    if (action === 'test-connection') {
      const provider = body?.provider;
      let result;
      if (provider === 'nvidia') result = await testNvidiaConnection(base44);
      else if (provider === 'gemini') result = await testGeminiConnection(base44);
      else result = await testConnection(base44);
      return Response.json(result);
    }

    // Diagnóstico de visión NVIDIA: envía UNA imagen de prueba (base64) como data URL
    // directa al endpoint. NO usa UploadFile ni InvokeLLM.
    if (action === 'test-nvidia-vision') {
      const previewBase64 = String(body?.preview_base64 || '').replace(/^data:image\/[a-z+]+;base64,/i, '');
      if (!previewBase64) return Response.json({ ok: false, reason: 'Falta preview_base64' });
      const result = await testNvidiaVision(base44, previewBase64);
      return Response.json(result);
    }

    // ------------------------------------------------------------------
    // Proveedores propios (CustomAiProvider).
    // ------------------------------------------------------------------
    if (action === 'list') {
      // Migra (una sola vez) los proveedores integrados a filas unificadas.
      await ensureBuiltinRows(base44);
      const list = await base44.asServiceRole.entities.CustomAiProvider.list('-updated_date', 100);
      return Response.json({ providers: (Array.isArray(list) ? list : []).map(maskProvider) });
    }

    if (action === 'add') {
      try {
        let endpoint = normalizeEndpoint(body.endpoint);
        const apiKey = String(body.api_key || '').trim();
        if (!apiKey) return Response.json({ ok: false, reason: 'Falta la API key' });
        // Gemini: la API nativa NO acepta Authorization Bearer (401). Se redirige a la
        // capa OpenAI-compatible oficial de Google (misma key, mismo modelo, formato OpenAI
        // en /chat/completions), compatible con todo el flujo de proveedores propios.
        const isGemini = new URL(endpoint).hostname === 'generativelanguage.googleapis.com';
        if (isGemini) endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
        const check = await fetchModels(endpoint, apiKey);
        if (!check.ok) {
          return Response.json({ ok: false, reason: `No se pudo verificar la conexión: ${check.reason}` });
        }
        // Los ids de Gemini llegan como "models/xyz": se normalizan a "xyz" para que la
        // página y el chat/completions usen el mismo identificador. Se normalizan también
        // en los objetos crudos para que buildModelsMeta produzca ids coherentes.
        const models = check.models.map((m: string) => m.replace(/^models\//, ''));
        const rawModels = check.raw.map((m: any) => ({ ...m, id: String(m?.id || m?.name || '').replace(/^models\//, '') }));
        // Capacidades resueltas desde metadatos declarados (fuente única de verdad).
        const meta = await resolveCapabilitiesFull(rawModels, undefined, endpoint, apiKey);
        // Preferencia del proyecto: los motores Gemini se limitan a gemini-2.5-flash.
        const flash = models.includes('gemini-2.5-flash') ? ['gemini-2.5-flash'] : [];
        const rec = await base44.asServiceRole.entities.CustomAiProvider.create({
          name: nameFromDomain(endpoint),
          endpoint,
          api_key: apiKey,
          available_models: models,
          available_models_meta: meta,
          seleccion_models: isGemini ? flash : [],
          ajustes_models: isGemini ? flash : [],
          // Legado: mejor modelo de vision detectado (fallback si nunca se marcan modelos).
          model: pickBestVisionModel(models),
          enabled: true,
          last_ok: true,
          last_reason: '',
          last_checked: new Date().toISOString(),
        });
        return Response.json({
          ok: true,
          provider: maskProvider(rec),
          total_models: check.models.length,
          latency_ms: check.latency_ms,
        });
      } catch (e: any) {
        return Response.json({ ok: false, reason: String(e?.message || e) });
      }
    }

    if (action === 'update-models') {
      const id = String(body.id || '');
      const clean = (v: any) => (Array.isArray(v) ? v.map((m: any) => String(m || '').trim()).filter(Boolean) : []);
      const rec = await base44.asServiceRole.entities.CustomAiProvider.update(id, {
        seleccion_models: clean(body.seleccion_models),
        ajustes_models: clean(body.ajustes_models),
        edicion_models: clean(body.edicion_models),
        video_models: clean(body.video_models),
        album_models: clean(body.album_models),
      });
      return Response.json({ ok: true, provider: maskProvider(rec) });
    }

    // Cambia la API key de un proveedor: verifica la clave nueva contra el endpoint y,
    // si es válida, la guarda en la fila y refresca la lista de modelos disponibles.
    if (action === 'update-key') {
      const id = String(body.id || '');
      const apiKey = String(body.api_key || '').trim();
      const rec: any = await base44.asServiceRole.entities.CustomAiProvider.get(id).catch(() => null);
      if (!rec) return Response.json({ ok: false, reason: 'Proveedor no encontrado' });
      if (!apiKey) return Response.json({ ok: false, reason: 'Falta la nueva API key' });
      const check = await fetchModels(rec.endpoint, apiKey);
      if (!check.ok) {
        return Response.json({ ok: false, reason: `La nueva clave no se pudo verificar: ${check.reason}` });
      }
      const models = check.models.map((m: string) => m.replace(/^models\//, ''));
      const rawModels = check.raw.map((m: any) => ({ ...m, id: String(m?.id || m?.name || '').replace(/^models\//, '') }));
      const updated = await base44.asServiceRole.entities.CustomAiProvider.update(id, {
        api_key: apiKey,
        available_models: models,
        available_models_meta: await resolveCapabilitiesFull(rawModels, rec.available_models_meta, rec.endpoint, apiKey),
        last_ok: true,
        last_reason: '',
        last_checked: new Date().toISOString(),
      });
      return Response.json({ ok: true, provider: maskProvider(updated), total_models: models.length });
    }

    // Guarda solo el proveedor activo por herramienta (sin tocar el resto de la config).
    if (action === 'save-active') {
      const patch: any = {};
      if (typeof body.active_seleccion === 'string' && body.active_seleccion.trim()) patch.active_seleccion = body.active_seleccion.trim();
      if (typeof body.active_ajustes === 'string' && body.active_ajustes.trim()) patch.active_ajustes = body.active_ajustes.trim();
      // Modelo EXACTO por tarea: se acepta cadena vacía ("Auto") para volver al modo
      // automático, por eso se comprueba undefined y no trim.
      if (body.active_model_seleccion !== undefined && typeof body.active_model_seleccion === 'string') patch.active_model_seleccion = body.active_model_seleccion.trim();
      if (body.active_model_ajustes !== undefined && typeof body.active_model_ajustes === 'string') patch.active_model_ajustes = body.active_model_ajustes.trim();
      // Álbum: cadena vacía = Auto (cadena por defecto de Album AI), por eso se acepta
      // cualquier string (sin exigir trim truthy).
      if (typeof body.active_album === 'string') patch.active_album = body.active_album.trim();
      if (body.active_model_album !== undefined && typeof body.active_model_album === 'string') patch.active_model_album = body.active_model_album.trim();
      const existing = await getConfigRecord(base44);
      let cfg;
      if (existing) {
        cfg = await base44.asServiceRole.entities.AiProviderConfig.update(existing.id, patch);
      } else {
        cfg = await base44.asServiceRole.entities.AiProviderConfig.create({
          active_seleccion: patch.active_seleccion || 'base44',
          active_ajustes: patch.active_ajustes || 'base44',
          active_album: patch.active_album || '',
        });
      }
      return Response.json({ ok: true, config: cfg });
    }

    if (action === 'retest') {
      const id = String(body.id || '');
      const rec: any = await base44.asServiceRole.entities.CustomAiProvider.get(id).catch(() => null);
      if (!rec) return Response.json({ ok: false, reason: 'Proveedor no encontrado' });
      const check = await fetchModels(rec.endpoint, effectiveKey(rec));
      const patch: any = {
        last_ok: check.ok,
        last_reason: check.ok ? '' : check.reason,
        last_checked: new Date().toISOString(),
      };
      if (check.ok) {
        const rawModels = check.raw.map((m: any) => ({ ...m, id: String(m?.id || m?.name || '').replace(/^models\//, '') }));
        patch.available_models = check.models.map((m: string) => m.replace(/^models\//, ''));
        // Cadena A→B→C: re-resuelve caps declaradas (A), cross-ref OpenRouter (B) y
        // sondea automáticamente los modelos que siguen null (C). CONSERVA true/false
        // de modelos ya clasificados (no los re-sondea). force=true los reclasifica todos.
        patch.available_models_meta = await resolveCapabilitiesFull(rawModels, rec.available_models_meta, rec.endpoint, effectiveKey(rec), { forceReprobe: !!body.force });
      }
      const updated = await base44.asServiceRole.entities.CustomAiProvider.update(id, patch);
      return Response.json({ ok: check.ok, reason: check.reason, provider: maskProvider(updated), total_models: check.models.length });
    }

    if (action === 'toggle') {
      const id = String(body.id || '');
      await base44.asServiceRole.entities.CustomAiProvider.update(id, { enabled: !!body.enabled });
      return Response.json({ ok: true });
    }

    // PROBAR CAPACIDAD DE VISIÓN (sondeo empírico bajo demanda). Envía una imagen de
    // prueba representativa (JPEG data URL generada en el navegador, NO 1x1, NO fotos
    // originales) al modelo usando EXACTAMENTE el mismo formato que la producción
    // (chat/completions con image_url). Inspecciona la respuesta real:
    //   - HTTP 200 + contenido textual  → visión verificada (vision=true).
    //   - HTTP 400/422/415 + error que cita image/vision/multimodal/not supported
    //     → modelo rechaza imagen (vision=false, verificado NO compatible).
    //   - timeout / error de red / otro error → NO se clasifica como sin visión
    //     (vision=null, no verificado) para evitar falsos negativos.
    // Persiste el resultado en available_models_meta (caché: no se re-prueba hasta que
    // el usuario pulse "Probar de nuevo" o cambie el endpoint/key).
    if (action === 'probe-vision') {
      const id = String(body.id || '');
      const model = String(body.model || '').trim();
      const image = String(body.image || '').trim();
      if (!id || !model) return Response.json({ ok: false, reason: 'Faltan id de proveedor o modelo' });
      if (!image || !/^data:image\/[a-z+]+;base64,/i.test(image)) {
        return Response.json({ ok: false, reason: 'Se requiere una imagen de prueba (data URL JPEG)' });
      }
      const rec: any = await base44.asServiceRole.entities.CustomAiProvider.get(id).catch(() => null);
      if (!rec) return Response.json({ ok: false, reason: 'Proveedor no encontrado' });
      const key = effectiveKey(rec);
      if (!key) return Response.json({ ok: false, reason: 'El proveedor no tiene API key' });
      const base = String(rec.endpoint || '').trim().replace(/\/+$/, '');
      if (!base) return Response.json({ ok: false, reason: 'El proveedor no tiene endpoint' });
      const endpoint = base + '/chat/completions';
      const content = [
        { type: 'text', text: 'Describe brevemente esta imagen en una frase corta.' },
        { type: 'image_url', image_url: { url: image } },
      ];
      let probeStatus: 'ok' | 'rejected' | 'error' = 'error';
      let vision: boolean | null = null;
      let reason = '';
      const t0 = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content }], stream: false, max_tokens: 256 }),
            signal: controller.signal,
          });
        } finally { clearTimeout(timer); }
        const txt = await res.text().catch(() => '');
        if (res.ok) {
          let data: any = null;
          try { data = JSON.parse(txt); } catch {}
          const out = String(data?.choices?.[0]?.message?.content || '').trim();
          if (out) { probeStatus = 'ok'; vision = true; reason = `OK: ${out.slice(0, 140)}`; }
          else { probeStatus = 'error'; vision = null; reason = 'Respuesta vacía del modelo'; }
        } else {
          const low = txt.toLowerCase();
          const rejectsImage = (res.status === 400 || res.status === 422 || res.status === 415) &&
            /image|vision|multimodal|not support|unsupported|modal|does not|no admite|no acepta/.test(low);
          if (rejectsImage) {
            probeStatus = 'rejected'; vision = false; reason = `HTTP ${res.status}: ${txt.slice(0, 200)}`;
          } else {
            probeStatus = 'error'; vision = null; reason = `HTTP ${res.status}: ${txt.slice(0, 200)}`;
          }
        }
      } catch (e: any) {
        probeStatus = 'error'; vision = null; reason = String(e?.message || e).slice(0, 200);
      }
      // Persistir en available_models_meta. Se RE-LEE el registro justo antes de
      // escribir para no perder los resultados de otros sondeos concurrentes sobre el
      // mismo proveedor (read-modify-write con ventana mínima: solo se parchea la
      // entrada de este modelo).
      const fresh: any = await base44.asServiceRole.entities.CustomAiProvider.get(id).catch(() => null);
      const meta = Array.isArray(fresh?.available_models_meta) ? fresh.available_models_meta.map((m: any) => ({ ...m })) : [];
      const idx = meta.findIndex((m: any) => String(m?.id || '') === model);
      const prevCaps = idx >= 0 ? (meta[idx].caps || {}) : {};
      const entry: any = {
        id: model,
        caps: { vision, image_edit: prevCaps.image_edit ?? null, video: prevCaps.video ?? null },
        source: vision === null ? 'unverified' : 'verified',
        probed_at: new Date().toISOString(),
        probe_status: probeStatus,
      };
      if (idx >= 0) meta[idx] = entry; else meta.push(entry);
      await base44.asServiceRole.entities.CustomAiProvider.update(id, { available_models_meta: meta });
      return Response.json({
        ok: vision === true,
        vision,
        status: probeStatus,
        reason,
        latency_ms: Date.now() - t0,
        model,
        provider: id,
      });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      await base44.asServiceRole.entities.CustomAiProvider.delete(id);
      // Si estaba activo para alguna tarea, revertir a base44 para no dejar una
      // referencia muerta en la configuración (los motores harían fallback).
      try {
        const cfg = await getConfigRecord(base44);
        if (cfg) {
          const patch: any = {};
          if (cfg.active_seleccion === `custom:${id}`) { patch.active_seleccion = 'base44'; patch.active_model_seleccion = ''; }
          if (cfg.active_ajustes === `custom:${id}`) { patch.active_ajustes = 'base44'; patch.active_model_ajustes = ''; }
          if (cfg.active_album === `custom:${id}`) { patch.active_album = ''; patch.active_model_album = ''; }
          if (Object.keys(patch).length) await base44.asServiceRole.entities.AiProviderConfig.update(cfg.id, patch);
        }
      } catch {}
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[ai-providers] error', error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}