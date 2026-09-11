import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { uploadPreviewBatch } from '../../shared/rawAiStudioEngine.ts';
import { runWithConcurrency } from '../../shared/concurrency.ts';
import { invokeVision } from '../../shared/aiProviderAdapter.ts';

// RAW AI Studio — POST /rawAiDedupCompare
//
// Comparación IA de casi-duplicados ENTRE grupos. El frontend detecta pares con pHash
// cercano (distinta escena) y los envía aquí. La IA compara VISUALMENTE (momento,
// expresión, ojos, interacción, composición, sujeto, foco, exposición, técnica) y decide:
//  - duplicate=true SOLO si capturan esencialmente el MISMO momento/pose/expresión.
//  - Si hay una diferencia SIGNIFICATIVA de momento/expresión/composición → NO son
//    duplicados aunque el framing/luz sea similar (duplicate=false → keep both).
//  - Si duplicate=true: conserva el de mejor momento/expresión/ojos; rebaja el otro.
// NUNCA elimina por overall numérico. Sin auto-rebaja ciega.
//
// Proveedor: el activo para Selección IA (active_seleccion / active_model_seleccion),
// enrutado por aiProviderAdapter.invokeVision — NUNCA Core.InvokeLLM ni Base44 AI.
// Concurrencia MAX_CONCURRENT=3. Los RAW nunca salen del equipo del usuario: solo su
// preview JPEG embebida.

const MAX_CONCURRENT = 3;

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    if (!pairs.length) return Response.json({ decisions: {} });

    const decisions: Record<string, any> = {};

    await runWithConcurrency(pairs, MAX_CONCURRENT, async (pair: any) => {
      const pairId = String(pair.pair_id);
      const idA = String(pair.id_a);
      const idB = String(pair.id_b);
      try {
        const uploaded = await uploadPreviewBatch(base44, [
          { id: idA, previewBase64: String(pair.preview_a_base64) },
          { id: idB, previewBase64: String(pair.preview_b_base64) },
        ]);
        const fileUrls = [uploaded[idA], uploaded[idB]].filter(Boolean);
        const ctxA = pair.context_a || {};
        const ctxB = pair.context_b || {};

        const prompt = `You are an elite photo editor checking for TRUE near-duplicates between two photos that came from DIFFERENT scenes/groups but whose perceptual hash is close. A close perceptual hash means similar overall composition/lighting — it does NOT mean the photos are duplicates.

Photo A (id=${idA}): prior status=${ctxA.status || '?'}, category=${ctxA.category || '?'}, prior note: ${ctxA.note || ''}.
Photo B (id=${idB}): prior status=${ctxB.status || '?'}, category=${ctxB.category || '?'}, prior note: ${ctxB.note || ''}.

Compare them VISUALLY on: moment, expression, eyes, interaction, composition, subject_quality, focus, exposure, technical.

Decide:
- duplicate: true ONLY if they capture essentially the SAME moment/pose/expression (a true burst duplicate). If there is a SIGNIFICANT difference in moment, expression, or composition, they are NOT duplicates even if the framing/lighting is similar — return duplicate=false.
- If duplicate=true: keep the one with better moment/expression/eyes; set demote to the other ("a" or "b"). If duplicate=false: keep both and set demote to "none".
- reason: cite the specific visual difference that drove the decision (moment, expression, eyes, composition...).

Return JSON: { duplicate: boolean, keep: "a"|"b"|"both", demote: "a"|"b"|"none", reason: string }.`;

        const trace: any = {};
        const result: any = await invokeVision(base44, {
          task: 'seleccion',
          prompt,
          file_urls: fileUrls,
          response_json_schema: {
            type: 'object',
            properties: {
              duplicate: { type: 'boolean' },
              keep: { type: 'string', enum: ['a', 'b', 'both'] },
              demote: { type: 'string', enum: ['a', 'b', 'none'] },
              reason: { type: 'string' },
            },
            required: ['duplicate', 'keep', 'reason'],
          },
          _trace: trace,
        });

        decisions[pairId] = {
          duplicate: !!result.duplicate,
          keep: result.keep || 'both',
          demote: result.demote && result.demote !== 'none' ? result.demote : null,
          reason: result.reason || '',
          _meta: {
            provider: trace.provider || trace.active_provider || null,
            model: trace.model || null,
            active_provider: trace.active_provider ?? null,
            configured_model: trace.configured_model ?? null,
            final_provider: trace.final_provider ?? null,
            final_model: trace.final_model ?? null,
            provider_failover: !!trace.failover,
            failover_reason: trace.failover_reason ?? null,
            attempts: Array.isArray(trace.attempts) ? trace.attempts : [],
            fallback: Array.isArray(trace.attempts) && trace.attempts.some((a: any) => !a.ok),
          },
        };
      } catch (e: any) {
        // IA no disponible: NO se rebaja nada (conservador). Se conservan ambas.
        decisions[pairId] = { duplicate: false, keep: 'both', demote: null, reason: `AI_UNAVAILABLE: ${e.message}` };
      }
    });

    return Response.json({ decisions });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}