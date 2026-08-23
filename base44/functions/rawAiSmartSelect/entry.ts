import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { uploadPreviewBatch } from '../../shared/rawAiStudioEngine.ts';

// RAW AI Studio — POST /rawAiSmartSelect
//
// Selección IA por ráfaga (local-first): recibe ráfagas con sus fotos candidatas (preview
// base64 de la preview embebida, nunca el RAW), sube las previews y pide al modelo de visión
// qué fotos kept de cada ráfaga. Devuelve { keep: { burst_id: [ids] }, reasons: { burst_id } }.
// Los RAW nunca salen del equipo del usuario.

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const bursts = Array.isArray(body?.bursts) ? body.bursts : [];
    if (!bursts.length) return Response.json({ keep: {}, reasons: {} });

    const keep: Record<string, string[]> = {};
    const reasons: Record<string, string | null> = {};

    await Promise.all(bursts.map(async (burst: any) => {
      const burstId = String(burst.burst_id);
      const bestId = String(burst.best_id);
      const candidates = Array.isArray(burst.photos) ? burst.photos : [];
      if (!candidates.length) { keep[burstId] = [bestId]; reasons[burstId] = null; return; }

      try {
        const uploaded = await uploadPreviewBatch(
          base44,
          candidates.map((c: any) => ({ id: String(c.id), previewBase64: String(c.preview_base64) }))
        );
        const fileUrls = candidates.map((c: any) => uploaded[String(c.id)]).filter(Boolean);
        const idList = candidates.map((c: any) => c.id).join(', ');

        const prompt = `You are a professional wedding photo editor doing culling. You are given ${candidates.length} photos from the same burst (same scene, taken seconds apart). The best technical shot (sharpest, best exposed) is id ${bestId}.

Decide which photo ids to KEEP for delivery:
- Usually keep ONLY the single best one (id ${bestId}).
- Keep an additional complementary shot ONLY if it is clearly useful for a fusion/Photoshop composite (a genuinely different expression/pose that adds value, not a near-duplicate).
- Never keep blurry or poorly exposed near-duplicates.

Candidate photo ids: ${idList}. The images are attached in the same order.
Return JSON with keep_ids (the ids to keep) and a short reason.`;

        const result: any = await base44.integrations.Core.InvokeLLM({
          prompt,
          file_urls: fileUrls,
          response_json_schema: {
            type: 'object',
            properties: {
              keep_ids: { type: 'array', items: { type: 'string' } },
              reason: { type: 'string' }
            },
            required: ['keep_ids', 'reason']
          }
        });

        const ids = Array.isArray(result.keep_ids) && result.keep_ids.length
          ? result.keep_ids.map(String)
          : [bestId];
        if (!ids.includes(bestId)) ids.unshift(bestId);
        keep[burstId] = ids;
        reasons[burstId] = typeof result.reason === 'string' ? result.reason : null;
      } catch (e: any) {
        keep[burstId] = [bestId];
        reasons[burstId] = null;
      }
    }));

    return Response.json({ keep, reasons });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}