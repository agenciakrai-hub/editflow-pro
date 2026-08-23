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
        const candidateIds = candidates.map((c: any) => String(c.id));

        const prompt = `You are an elite professional wedding photo editor doing precise culling. You are given ${candidates.length} photos from the SAME burst (same scene, same people, taken seconds apart). The reference technical shot (sharpest/best exposed by metadata) is id ${bestId}, but your job is to judge the FACES, not just the technicals.

STEP 1 — For EACH candidate, carefully analyze EVERY visible face in the frame (not just the main subject):
- Eyes: open / partially closed / closed / blinking. Count faces with closed or partially-closed eyes.
- Facial sharpness: is each face crisply in focus, or soft/blurry (focus missed on the face)?
- Expression: natural and flattering, or awkward / strained / mid-speech?
- Motion: any subject blur, movement, or awkward posture?
Group tolerance: in a LARGE group (8+ people) one partially-closed eye on a minor person is acceptable; in a SMALL group (≤7) or a portrait, every key face must have open eyes.

STEP 2 — Decide which photo id(s) to KEEP for delivery:
- Pick the SINGLE photo with the best faces: all (or nearly all) eyes open, faces sharp, expression natural. This OVERRIDES the technical reference if another candidate clearly has better faces — do not blindly keep ${bestId}.
- You MUST keep at least one photo from this burst. Even if none is perfect, keep the best-available one (fewest closed eyes, sharpest faces). Never return an empty keep_ids.
- Keep an additional complementary shot ONLY if it is genuinely different (distinct pose/expression useful for a composite) AND its faces are also good. Never keep a near-duplicate, a shot with a key face with closed eyes, or a blurry shot.

Candidate photo ids: ${idList}. The images are attached in the same order. Reference technical shot: ${bestId}.
Return JSON: keep_ids (the ids to keep, at least one, in priority order — best face first) and a short reason citing how many faces had closed eyes and which shot was sharpest.`;

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

        // Validación estricta: solo ids que existen en la ráfaga, y siempre al menos uno.
        const ids = Array.isArray(result.keep_ids)
          ? result.keep_ids.map(String).filter((id: string) => candidateIds.includes(id))
          : [];
        keep[burstId] = ids.length ? ids : [bestId];
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