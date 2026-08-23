import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  testConnection,
  testNvidiaConnection,
  testNvidiaVision,
  testGeminiConnection,
  isQwenKeyPresent,
  isNvidiaKeyPresent,
  isGeminiKeyPresent,
} from '../../shared/aiProviderAdapter.ts';

// Proveedores IA — admin-only. Acciones: get-config, save-config, test-connection,
// test-nvidia-vision. NUNCA devuelve las API Keys (solo *_key_present boolean). Las
// claves viven como secrets de Base44 (QWEN_API_KEY, NVIDIA_API_KEY) y se leen solo
// en backend.

const NVIDIA_DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL = 'minimaxai/minimax-m3';
const GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'get-config') {
      const list = await base44.asServiceRole.entities.AiProviderConfig.list();
      const cfg = Array.isArray(list) && list.length ? list[0] : null;
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
        active_seleccion: ['qwen', 'base44', 'nvidia', 'gemini', 'none'].includes(body.active_seleccion) ? body.active_seleccion : 'base44',
        active_ajustes: ['qwen', 'base44', 'nvidia', 'gemini', 'none'].includes(body.active_ajustes) ? body.active_ajustes : 'base44',
      };
      const list = await base44.asServiceRole.entities.AiProviderConfig.list();
      const existing = Array.isArray(list) && list.length ? list[0] : null;
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

    if (action === 'test-nvidia-vision') {
      const previewBase64 = typeof body?.preview_base64 === 'string' ? body.preview_base64.trim() : '';
      const result = await testNvidiaVision(base44, previewBase64);
      return Response.json(result);
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[ai-providers] error', error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}