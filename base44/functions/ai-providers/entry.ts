import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { testConnection, isQwenKeyPresent } from '../../shared/aiProviderAdapter.ts';

// Proveedores IA — admin-only. Acciones: get-config, save-config, test-connection.
// NUNCA devuelve la API Key (solo key_present boolean). La clave vive como secret
// de Base44 (QWEN_API_KEY) y se lee solo en backend.

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
      return Response.json({ config: cfg, qwen_key_present: isQwenKeyPresent() });
    }

    if (action === 'save-config') {
      const patch = {
        qwen_enabled: !!body.qwen_enabled,
        qwen_endpoint: typeof body.qwen_endpoint === 'string' ? body.qwen_endpoint.trim() : '',
        qwen_model: typeof body.qwen_model === 'string' ? body.qwen_model.trim() : 'qwen3-vl-plus',
        base44_enabled: body.base44_enabled !== false,
        active_seleccion: ['qwen', 'base44', 'none'].includes(body.active_seleccion) ? body.active_seleccion : 'base44',
        active_ajustes: ['qwen', 'base44', 'none'].includes(body.active_ajustes) ? body.active_ajustes : 'base44',
      };
      const list = await base44.asServiceRole.entities.AiProviderConfig.list();
      const existing = Array.isArray(list) && list.length ? list[0] : null;
      let cfg;
      if (existing) {
        cfg = await base44.asServiceRole.entities.AiProviderConfig.update(existing.id, patch);
      } else {
        cfg = await base44.asServiceRole.entities.AiProviderConfig.create(patch);
      }
      return Response.json({ config: cfg, qwen_key_present: isQwenKeyPresent() });
    }

    if (action === 'test-connection') {
      const result = await testConnection(base44);
      return Response.json(result);
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[ai-providers] error', error);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}