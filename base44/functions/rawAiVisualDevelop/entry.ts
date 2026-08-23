// Revelado IA Visual — POST /rawAiVisualDevelop
//
// Entrada (JSON):
//   { photos: [{ id, preview_base64 }], preferences?: { [param]: number } }
//
// Salida (JSON):
//   { results: { "0": { Exposure2012, Contrast2012, ... } }, errors: {}, confidences: {} }
//
// La IA (Qwen) analiza el CONTENIDO de cada foto y decide los ajustes de revelado
// completos de Lightroom. Sin baseline tecnico: valores absolutos profesionales.
// Las previews se envian como data URLs directas (sin UploadFile ni InvokeLLM Base44).
// La preferencia del fotografo se suma a la decision de la IA.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { developPhotoVisual } from '../../shared/visualDevelopEngine.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const photos = Array.isArray(body?.photos) ? body.photos : null;
    const preferences = body?.preferences && typeof body.preferences === 'object' ? body.preferences : {};

    if (!photos || !photos.length) {
      return Response.json(
        { error: 'Expected { photos: [{ id, preview_base64 }] }' },
        { status: 400 }
      );
    }

    const results: Record<string, any> = {};
    const confidences: Record<string, number | null> = {};
    const errors: Record<string, string> = {};

    for (const p of photos) {
      const id = String(p.id);
      try {
        if (!p.preview_base64) {
          errors[id] = 'No image data provided';
          continue;
        }
        const { values, confidence } = await developPhotoVisual(
          base44,
          String(p.preview_base64),
          preferences
        );
        results[id] = values;
        confidences[id] = confidence;
      } catch (e: any) {
        errors[id] = e.message;
      }
    }

    return Response.json({ results, errors, confidences });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}