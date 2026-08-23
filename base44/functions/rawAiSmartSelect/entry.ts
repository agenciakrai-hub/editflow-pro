import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { uploadPreviewBatch } from '../../shared/rawAiStudioEngine.ts';

// RAW AI Studio — POST /rawAiSmartSelect
//
// Culling profesional por escena (local-first): recibe escenas con sus fotos candidatas
// (preview base64 embebida, nunca el RAW), sube las previews y pide al modelo de visión
// un análisis MULTIDIMENSIONAL de cada candidata + una decisión COMPARATIVA dentro del
// grupo. Devuelve por escena: keep_ids, categoría de género, rankings por foto (rango,
// estado TOP_PICK/SELECT/REVIEW/REJECT, puntuaciones por dimensión, motivos de descarte
// estructurados) y un reason. Los RAW nunca salen del equipo del usuario.
//
// Estados: SELECT (válida), TOP_PICK (la más fuerte del grupo), REVIEW (incertidumbre),
// REJECT (descarte claro). REJECT solo ante defectos combinados claros, nunca por una
// sola métrica. Garantiza al menos una foto con estado SELECT/TOP_PICK por escena.

const SCORE_KEYS = [
  'technical', 'sharpness', 'focus', 'face_quality', 'eye_quality',
  'expression', 'composition', 'exposure', 'color_quality', 'subject_quality',
  'moment_quality', 'distraction_penalty', 'overall', 'confidence'
];

function scoreProps() {
  const props: Record<string, any> = {};
  for (const k of SCORE_KEYS) props[k] = { type: 'number', description: `${k} 0-100` };
  return props;
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const bursts = Array.isArray(body?.bursts) ? body.bursts : [];
    if (!bursts.length) return Response.json({ groups: {} });

    const groups: Record<string, any> = {};

    await Promise.all(bursts.map(async (burst: any, gi: number) => {
      const burstId = String(burst.burst_id);
      const candidates = Array.isArray(burst.photos) ? burst.photos : [];
      const candidateIds = candidates.map((c: any) => String(c.id));
      if (!candidates.length) {
        groups[burstId] = { keep_ids: [], category: null, reason: 'Sin candidatas', rankings: [] };
        return;
      }

      try {
        const uploaded = await uploadPreviewBatch(
          base44,
          candidates.map((c: any) => ({ id: String(c.id), previewBase64: String(c.preview_base64) }))
        );
        const fileUrls = candidates.map((c: any) => uploaded[String(c.id)]).filter(Boolean);
        const idList = candidateIds.join(', ');

        const prompt = `You are an elite professional photo editor doing precise, conservative culling of a ${candidates.length}-photo sequence (same scene, same people, taken seconds apart). This is NOT a per-photo yes/no — you must COMPARE the photos within this group.

STEP 1 — Classify the group's genre (one of): portrait, wedding, event, group, architecture, interior, landscape, product, lifestyle, documentary.

STEP 2 — For EACH candidate, analyze independently across ALL dimensions (0-100 each):
- technical: file integrity, noise, artifacts, capture problems
- sharpness: global sharpness
- focus: is the SUBJECT (face/person/key element) in sharp focus, or is the focus missed? Distinguish artistic background blur from accidental subject blur — a deliberately blurred background must NOT lower focus_score.
- face_quality: if people present, face visibility/quality (null-equivalent 100 if no people)
- eye_quality: eyes open vs closed/blinking for EVERY visible face (groups: ≤7 people → all key faces must have open eyes; 8+ → one minor closed eye acceptable)
- expression: natural/emotive vs awkward/strained (for people)
- composition: balance, framing, lines, geometry, distracting elements, awkward crops
- exposure: tonal distribution, clipping, severe over/underexposure
- color_quality: white balance neutrality, color cast, skin tones
- subject_quality: clarity/presence of the main subject
- moment_quality: decisive moment, emotion, interaction (people/events); for architecture/landscape this reflects stillness/cleanliness instead
- distraction_penalty: HIGHER = more distracting problems (inverted: 100 = clean)
- overall: your composite judgment, WEIGHTED BY GENRE (portrait/wedding → eyes+expression+focus dominate; architecture/interior → geometry+verticals+exposure dominate). The highest global sharpness does NOT have to win.
- confidence: 0-100 how sure you are of this photo's assessment

STEP 3 — Decide COMPARATIVELY (relative ranking inside this group):
- Rank every candidate (rank 1 = best in group).
- Assign a status to each:
  - TOP_PICK: the single strongest frame of the group (best faces + moment + composition). At most ONE per group.
  - SELECT: technically valid and visually strong enough to deliver.
  - REVIEW: the AI is not confident (low confidence, borderline faces/exposure, or a near-tie with a clearly better one but not clearly rejectable). When in doubt → REVIEW, never auto-reject.
  - REJECT: only for a CLEAR, COMBINED defect — never a single metric alone. Use structured reject_reasons from: CRITICAL_BLUR, FOCUS_FAILURE, EYES_CLOSED, DUPLICATE, LOWER_RANK_IN_BURST, POOR_EXPRESSION, POOR_COMPOSITION, SEVERE_EXPOSURE_FAILURE, OBSTRUCTED_SUBJECT, CORRUPT.
- GUARANTEE: at least one photo in the group must be SELECT or TOP_PICK. Even if none is perfect, pick the best-available (fewest closed eyes, sharpest faces). Never return a group with only REVIEW/REJECT.
- DIVERSITY: do not mark near-duplicates as TOP_PICK; reserve TOP_PICK for the genuinely strongest frame.

Candidate photo ids: ${idList}. The images are attached in the same order.

Return JSON for this group (key "group_${gi}") with: keep_ids (the SELECT+TOP_PICK ids, at least one, best first), category (the genre string), reason (short explanation citing faces/eyes/expression and why the TOP_PICK won), and rankings (one object per candidate with id, rank, status, reject_reasons array, the ${SCORE_KEYS.join(', ')} scores, and a short note).`;

        const groupSchema: any = {
          type: 'object',
          properties: {
            keep_ids: { type: 'array', items: { type: 'string' } },
            category: { type: 'string' },
            reason: { type: 'string' },
            rankings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  rank: { type: 'number' },
                  status: { type: 'string', enum: ['TOP_PICK', 'SELECT', 'REVIEW', 'REJECT'] },
                  reject_reasons: { type: 'array', items: { type: 'string' } },
                  note: { type: 'string' },
                  ...scoreProps(),
                },
                required: ['id', 'rank', 'status', 'reject_reasons', 'overall', 'confidence', ...SCORE_KEYS],
              },
            },
          },
          required: ['keep_ids', 'category', 'reason', 'rankings'],
        };

        const result: any = await base44.integrations.Core.InvokeLLM({
          prompt,
          file_urls: fileUrls,
          response_json_schema: {
            type: 'object',
            properties: { [`group_${gi}`]: groupSchema },
            required: [`group_${gi}`],
          },
        });

        const g = result[`group_${gi}`] || {};
        const rankings = Array.isArray(g.rankings) ? g.rankings : [];
        const byId: Record<string, any> = {};
        for (const r of rankings) {
          const rid = String(r.id);
          if (!candidateIds.includes(rid)) continue;
          byId[rid] = {
            rank: typeof r.rank === 'number' ? r.rank : 999,
            status: ['TOP_PICK', 'SELECT', 'REVIEW', 'REJECT'].includes(r.status) ? r.status : 'REVIEW',
            reject_reasons: Array.isArray(r.reject_reasons) ? r.reject_reasons : [],
            note: typeof r.note === 'string' ? r.note : '',
            scores: SCORE_KEYS.reduce((acc: Record<string, number>, k) => {
              acc[k] = typeof r[k] === 'number' ? Math.min(100, Math.max(0, r[k])) : 0;
              return acc;
            }, {}),
          };
        }

        // Validación de keep_ids: solo ids válidos, al menos uno; forzar diversidad de TOP_PICK.
        let keepIds = Array.isArray(g.keep_ids)
          ? g.keep_ids.map(String).filter((id: string) => candidateIds.includes(id))
          : [];
        // Asegurar al menos un SELECT/TOP_PICK.
        const selectable = candidateIds.filter((id) => {
          const st = byId[id]?.status;
          return st === 'SELECT' || st === 'TOP_PICK';
        });
        if (!keepIds.length) keepIds = selectable.length ? selectable : [candidateIds[0]];
        if (!selectable.length && byId[candidateIds[0]]) byId[candidateIds[0]].status = 'SELECT';

        // Diversidad: a lo sumo un TOP_PICK por grupo (el de mayor overall). El resto → SELECT.
        let topId: string | null = null;
        let topOverall = -1;
        for (const id of candidateIds) {
          const r = byId[id];
          if (r && r.status === 'TOP_PICK') {
            const ov = r.scores?.overall ?? 0;
            if (ov > topOverall) { topOverall = ov; topId = id; }
          }
        }
        for (const id of candidateIds) {
          if (!byId[id]) {
            byId[id] = { rank: 999, status: 'REVIEW', reject_reasons: [], note: '', scores: {} };
          }
          if (byId[id].status === 'TOP_PICK' && id !== topId) byId[id].status = 'SELECT';
        }

        groups[burstId] = {
          keep_ids: keepIds,
          category: typeof g.category === 'string' ? g.category : null,
          reason: typeof g.reason === 'string' ? g.reason : null,
          rankings: candidateIds.map((id) => ({ id, ...byId[id] })),
        };
      } catch (e: any) {
        // Fallback determinista conservador: conserva la mejor toma (rango 1) como SELECT.
        groups[burstId] = {
          keep_ids: [candidateIds[0]],
          category: null,
          reason: `Análisis IA no disponible: ${e?.message || 'error'}`,
          rankings: candidateIds.map((id, i) => ({
            id,
            rank: i + 1,
            status: i === 0 ? 'SELECT' : 'REVIEW',
            reject_reasons: [],
            note: 'Evaluación IA no disponible — clasificado para revisión manual',
            scores: {},
          })),
        };
      }
    }));

    return Response.json({ groups });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}