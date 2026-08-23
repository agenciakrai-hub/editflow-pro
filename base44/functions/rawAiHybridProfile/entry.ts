// Revelado Híbrido — POST /rawAiHybridProfile
//
// Entrada (JSON):
//   { representatives: [{ id, preview_base64 }], preferences?: { [param]: number } }
//
// Salida (JSON):
//   { profile: { base_recipe: { Exposure2012, Contrast2012, ... }, analysis: string, confidence: number } }
//
// La IA analiza SOLO las K fotos representativas (una sola llamada Vision) y genera un
// perfil de sesión. El motor local (cliente) adapta ese perfil a cada foto. Económico:
// 1 llamada de IA para toda la sesión, no 1 por foto. Las previews van como data URLs
// directas (sin UploadFile ni InvokeLLM Base44).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { generateSessionProfile } from '../../shared/hybridDevelopEngine.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const reps = Array.isArray(body?.representatives) ? body.representatives : null;
    const preferences = body?.preferences && typeof body.preferences === 'object' ? body.preferences : {};

    if (!reps || !reps.length) {
      return Response.json(
        { error: 'Expected { representatives: [{ id, preview_base64 }] }' },
        { status: 400 }
      );
    }

    const profile = await generateSessionProfile(base44, reps, preferences);
    return Response.json({ profile });
  } catch (error: any) {
    console.error('rawAiHybridProfile error', error?.message || error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}