import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { analyzePhotoBatchParams, uploadPreviewBatch, LLM_BATCH_SIZE } from '../../shared/rawAiStudioEngine.ts';
import { runWithConcurrency } from '../../shared/concurrency.ts';

// RAW AI Studio — POST /rawAiStudioAnalyze
//
// Entrada (JSON):
//   { photos: [{ id, preview_base64, baseline?, technical_confidence?, camera? }],
//     enabled_params: string[],
//     preferences: { [param]: number },
//     precision_mode?: string }
//
// Salida (JSON):
//   { results: { "0": { Exposure2012, ... }, ... }, errors: { "1": "mensaje" }, confidences: { "0": 80 } }
//
// Calcula SOLO los parámetros explícitamente activados. La IA calcula su corrección
// normal; la preferencia del fotógrafo se SUMA a ese resultado. Nunca WB, curvas, HSL,
// calibración, máscaras ni estilo artístico.
//
// OPTIMIZACIÓN DE VELOCIDAD: las previews se suben todas en paralelo (no una a una) y
// las fotos se agrupan en lotes de LLM_BATCH_SIZE dentro de una sola llamada InvokeLLM.
// Antes: 12 fotos = 12 llamadas InvokeLLM. Ahora: 12 fotos = 2 llamadas (lotes de 6).
// El modelo de visión procesa varias imágenes a la vez — mismo resultado, 6x menos
// llamadas y latencia de red.

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const photos = Array.isArray(body?.photos) ? body.photos : null;
    const enabledParams = Array.isArray(body?.enabled_params) ? body.enabled_params : [];
    const preferences = body?.preferences && typeof body.preferences === 'object' ? body.preferences : {};

    if (!photos || !photos.length) {
      return Response.json(
        { error: 'Expected { photos: [{ id, preview_base64 }] }' },
        { status: 400 }
      );
    }
    if (!enabledParams.length) {
      return Response.json({ results: {}, errors: {}, confidences: {} });
    }

    const precisionMode = typeof body?.precision_mode === 'string' ? body.precision_mode : 'balanced';
    const results: Record<string, any> = {};
    const confidences: Record<string, number | null> = {};
    const errors: Record<string, string> = {};

    const validPhotos = photos.filter((p: any) => p.preview_base64);
    for (const p of photos) {
      if (!p.preview_base64) errors[String(p.id)] = 'No image data provided';
    }

    if (!validPhotos.length) {
      return Response.json({ results, errors, confidences });
    }

    // Subir todas las previews en paralelo (antes se subían una a una dentro de
    // analyzePhotoParams, secuencialmente con cada llamada IA).
    const uploaded = await uploadPreviewBatch(
      base44,
      validPhotos.map((p: any) => ({ id: String(p.id), previewBase64: String(p.preview_base64) })),
      "ajustes"
    );

    // Agrupar en lotes de LLM_BATCH_SIZE y procesar todos los lotes en paralelo.
    const llmBatches: any[][] = [];
    for (let i = 0; i < validPhotos.length; i += LLM_BATCH_SIZE) {
      llmBatches.push(validPhotos.slice(i, i + LLM_BATCH_SIZE));
    }

    const traces: any[] = [];
    await runWithConcurrency(llmBatches, llmBatches.length, async (llmBatch: any[]) => {
      const batchPhotos = llmBatch.map((p: any) => ({
        id: String(p.id),
        previewFileUrl: uploaded[String(p.id)],
        baseline: p.baseline || null,
        technicalConfidence: typeof p.technical_confidence === 'number' ? p.technical_confidence : null,
        camera: p.camera || null
      }));
      const analysis = await analyzePhotoBatchParams(base44, batchPhotos, enabledParams, preferences, precisionMode);
      Object.assign(results, analysis.values);
      Object.assign(confidences, analysis.confidences);
      Object.assign(errors, analysis.errors);
      if (analysis.trace) traces.push(analysis.trace);
    });

    return Response.json({ results, errors, confidences, _trace: traces });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}