import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { uploadPreviewBatch } from '../../shared/rawAiStudioEngine.ts';
import { runWithConcurrency } from '../../shared/concurrency.ts';
import { invokeVision } from '../../shared/aiProviderAdapter.ts';

// RAW AI Studio — POST /rawAiSmartSelect
//
// Culling profesional por escena (local-first): recibe escenas con TODAS sus fotos
// (preview base64 embebida + métricas técnicas de Pass 1, nunca el RAW), sube las
// previews y pide al modelo de visión un análisis MULTIDIMENSIONAL de cada candidata
// + una decisión COMPARATIVA dentro del grupo. Devuelve por escena: keep_ids,
// categoría de género, rankings por foto (rango, estado TOP_PICK/SELECT/REVIEW/REJECT,
// puntuaciones por dimensión, motivos de descarte estructurados, analysis_complete,
// missing_dimensions) y un reason. Los RAW nunca salen del equipo del usuario.
//
// PRIORIDAD: PRECISIÓN > CONSERVACIÓN > RANKING > ESTABILIDAD > VELOCIDAD.
//
// Estados: TOP_PICK (única mejor del grupo, máx 1), SELECT (válida y fuerte),
// REVIEW (incertidumbre / empate / defecto no concluyente), REJECT (solo defecto
// COMBINADO claro, nunca por una sola métrica). Una foto única (singleton) NO se
// fuerza a SELECT: puede ser SELECT/REVIEW/REJECT según su calidad. No se garantiza
// selección si todas son claramente REJECT.
//
// Modelo de visión: claude_sonnet_4_6 (mejor relación calidad/velocidad en visión de
// caras, ojos y expresión para culling de bodas). Sin add_context_from_internet
// (privacidad de previews). Concurrencia controlada (MAX_CONCURRENT_LLM=3).
//
// Grupos grandes: si el grupo supera MAX_IMAGES_PER_CALL, se parte en DOS llamadas
// comparativas que cubren todo el grupo (ninguna foto queda fuera por sharpness/
// exposure) y se consolida el ranking deterministamente (un único TOP_PICK global).

const MODEL = 'claude_sonnet_4_6';
const MAX_IMAGES_PER_CALL = 12;
const MAX_CONCURRENT_LLM = 3;
// Para grupos > MAX_IMAGES_PER_CALL: dos llamadas (mitades) + una TERCERA llamada de
// consolidación SOLO entre los mejores candidatos de ambas mitades (re-análisis visual,
// no overall numérico). Finalistas por mitad.
const FINALISTS_PER_HALF = 4;

const SCORE_KEYS = [
  'technical', 'sharpness', 'focus', 'face_quality', 'eye_quality',
  'expression', 'composition', 'exposure', 'color_quality', 'subject_quality',
  'moment_quality', 'distraction_penalty', 'overall', 'confidence'
] as const;

// Dimensiones que solo aplican cuando hay personas/rostros relevantes en la foto.
const PERSON_DIMS = ['face_quality', 'eye_quality', 'expression'] as const;
// Géneros sin personas: en ellos las dimensiones faciales son NO aplicables.
const NO_PEOPLE_GENRES = new Set(['architecture', 'interior', 'landscape', 'product']);

function isPeopleGenre(cat: string | null | undefined): boolean {
  // Por defecto (categoría desconocida) se asume que hay personas: conservador, no
  // anula dimensiones faciales salvo que el género sea claramente sin personas.
  return cat ? !NO_PEOPLE_GENRES.has(cat) : true;
}
function applicableDims(cat: string | null | undefined): readonly string[] {
  const people = isPeopleGenre(cat);
  return SCORE_KEYS.filter((k) => people || !PERSON_DIMS.includes(k));
}

function scoreProps() {
  const props: Record<string, any> = {};
  for (const k of SCORE_KEYS) {
    const isPerson = PERSON_DIMS.includes(k);
    // El schema exige number (no null): un schema nullable provoca que el modelo
    // devuelva null para TODO. En su lugar, el backend fuerza a null las dimensiones
    // faciales en géneros sin personas (guardia isPeopleGenre en buildRankingEntry).
    props[k] = {
      type: 'number',
      description: `${k} 0-100. OMIT this field (do not return 0) when it is not applicable${isPerson ? ' — e.g. no people in the frame' : ''} or you cannot evaluate it.`,
    };
  }
  return props;
}

// Normaliza un score: número finito → clamp 0-100; resto → null (NUNCA 0).
function normScore(v: any): number | null {
  if (typeof v === 'number' && isFinite(v)) return Math.min(100, Math.max(0, v));
  return null;
}

// overall ignorando dimensiones null.
function computeOverall(scores: Record<string, number | null>): number | null {
  if (typeof scores.overall === 'number') return scores.overall;
  const keys = SCORE_KEYS.filter((k) => k !== 'overall' && k !== 'confidence');
  const vals = keys.map((k) => scores[k]).filter((v): v is number => typeof v === 'number');
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function statusRank(s: string): number {
  return s === 'TOP_PICK' ? 0 : s === 'SELECT' ? 1 : s === 'REVIEW' ? 2 : 3;
}

const VALID_STATUS = ['TOP_PICK', 'SELECT', 'REVIEW', 'REJECT'];

function buildRankingEntry(id: string, r: any, category: string | null = null): any {
  const status = VALID_STATUS.includes(r?.status) ? r.status : 'REVIEW';
  const scores: Record<string, number | null> = {};
  for (const k of SCORE_KEYS) scores[k] = normScore(r?.[k]);
  // Guardia de género: en fotos sin personas (arquitectura/interior/paisaje/producto)
  // las dimensiones faciales son NO aplicables → null, aunque el modelo devuelva 0 o
  // un número. Así no se penaliza una foto sin personas por carecer de métricas faciales
  // y el overall (calculado) ignora esas dimensiones.
  if (!isPeopleGenre(category)) {
    for (const d of PERSON_DIMS) scores[d] = null;
  }
  if (typeof scores.overall !== 'number') scores.overall = computeOverall(scores);
  // missing_dimensions incluye las N/A (null). analysis_complete solo exige que todas
  // las dimensiones APLICABLES al tipo de foto hayan sido evaluadas.
  const missing = SCORE_KEYS.filter((k) => scores[k] === null);
  const applicableMissing = applicableDims(category).filter((k) => scores[k] === null);
  return {
    id,
    rank: typeof r?.rank === 'number' ? r.rank : 999,
    status,
    reject_reasons: Array.isArray(r?.reject_reasons) ? r.reject_reasons : [],
    note: typeof r?.note === 'string' ? r.note : '',
    scores,
    analysis_complete: applicableMissing.length === 0,
    missing_dimensions: missing,
  };
}

// Fallback técnico conservador cuando la IA no está disponible. Usa las métricas
// técnicas de Pass 1 enviadas por el frontend (sharpness, exposureScore, corrupt).
// Conserva la mejor candidata técnicamente válida del grupo como REVIEW (o SELECT si
// es claramente superior); el resto a REVIEW. NUNCA finge que la decisión vino de la
// IA: reason = AI_UNAVAILABLE_TECHNICAL_FALLBACK, analysis_complete = false.
function technicalFallback(candidateIds: string[], technicals: Record<string, any>): any {
  const valid = candidateIds.filter((id) => {
    const t = technicals[id];
    return t && !t.corrupt;
  });
  let bestId: string | null = null;
  let bestScore = -1;
  for (const id of valid) {
    const t = technicals[id];
    const s = (t.sharpness ?? 0) * 0.6 + (t.exposureScore ?? 0.5) * 0.4;
    if (s > bestScore) { bestScore = s; bestId = id; }
  }
  const bestTech = bestId ? technicals[bestId] : null;
  const bestClearlySuperior = !!bestId && bestScore > 0.4 && ((bestTech?.exposureScore ?? 0) > 0.6);
  const rankings = candidateIds.map((id) => {
    const isBest = id === bestId;
    return {
      id,
      rank: isBest ? 1 : 999,
      status: isBest ? (bestClearlySuperior ? 'SELECT' : 'REVIEW') : 'REVIEW',
      reject_reasons: [],
      note: 'Evaluación IA no disponible — clasificado por fallback técnico',
      scores: {},
      analysis_complete: false,
      missing_dimensions: [...SCORE_KEYS],
    };
  });
  const keep = bestClearlySuperior && bestId ? [bestId] : [];
  return {
    keep_ids: keep,
    category: null,
    reason: 'AI_UNAVAILABLE_TECHNICAL_FALLBACK',
    rankings,
  };
}

// Construye el prompt comparativo para un subconjunto (grupo entero o mitad).
function buildPrompt(ids: string[], isSingleton: boolean): string {
  const idList = ids.join(', ');
  const singletonRule = isSingleton
    ? `\nSINGLETON: this group has a SINGLE photo. There is no comparison to make — assess it on its own merits. It can be TOP_PICK/SELECT if clearly good, REVIEW if doubtful, or REJECT only for a CLEAR COMBINED defect (critical blur + missed focus, severe exposure failure, corrupt). Do NOT force a SELECT just because it is alone.`
    : `\nGUARANTEE for multi-photo groups: rank every candidate (rank 1 = best). At most ONE TOP_PICK. If at least one photo is clearly deliverable, mark the best as TOP_PICK or SELECT. If ALL are genuinely rejectable (clear combined defects), it is acceptable to return only REJECT — do not fabricate a SELECT. When in doubt between two near-equal frames, prefer the one with better eyes/expression/moment over the one with marginally higher sharpness.`;

  return `You are an elite professional photo editor doing precise, conservative culling of a ${ids.length}-photo sequence (same scene, same people, taken seconds apart). This is NOT a per-photo yes/no — you must COMPARE the photos within this group and rank them.

STEP 1 — Classify the group's genre (one of): portrait, wedding, event, group, architecture, interior, landscape, product, lifestyle, documentary.

STEP 2 — Apply the genre's PRIORITY POLICY to weight dimensions (do not use rigid weights; let the genre shift emphasis):
- portrait / wedding: eyes > expression > focus on subject > moment > composition > technical. A slightly less sharp frame with open eyes, genuine emotion and a decisive moment MUST beat a sharper but lifeless/blinked frame.
- group: eyes of the principal people > expression > focus > composition > moment. For ≤7 people every key face must have open eyes; for 8+ one minor closed eye is acceptable.
- event: moment > expression > interaction > focus > composition.
- architecture / interior: composition > geometry > verticals > exposure > sharpness > absence of distractions. No people → face/eye/expression are NOT APPLICABLE.
- landscape: composition > light/moment > exposure > sharpness > distractions.

STEP 3 — For EACH candidate, analyze independently across ALL dimensions. Each score is 0-100, or null when the dimension is NOT APPLICABLE (e.g. a landscape/interior/product with no people → face_quality, eye_quality, expression = null). NEVER return 0 to mean "not applicable" — return null. Return 0 only for a genuinely evaluated, critically bad dimension:
- technical: file integrity, noise, artifacts, capture problems
- sharpness: global sharpness
- focus: is the SUBJECT (face/person/key element) in sharp focus? Distinguish artistic background blur from accidental subject blur — deliberate bokeh must NOT lower focus.
- face_quality: if people present, face visibility/quality. If NO people in the frame → return null.
- eye_quality: eyes open vs closed/blinking for EVERY visible face. No people → return null.
- expression: natural/emotive vs awkward/strained. No people → return null.
- composition: balance, framing, lines, geometry, distracting elements, awkward crops
- exposure: tonal distribution, clipping, severe over/underexposure
- color_quality: white balance neutrality, color cast, skin tones
- subject_quality: clarity/presence of the main subject
- moment_quality: decisive moment, emotion, interaction (people/events); for architecture/landscape reflects stillness/cleanliness
- distraction_penalty: HIGHER = cleaner (100 = no distractions, 0 = very distracting). Inverted scale.
- overall: your composite judgment WEIGHTED BY GENRE per STEP 2. The globally sharpest frame does NOT have to win.
- confidence: 0-100 how sure you are of THIS photo's assessment (low confidence → prefer REVIEW, never REJECT)

STEP 4 — Decide COMPARATIVELY (relative ranking inside this group):
- TOP_PICK: the single strongest frame (best faces + moment + composition). At most ONE.
- SELECT: technically valid and visually strong enough to deliver.
- REVIEW: not confident (low confidence, borderline faces/exposure, near-tie with a clearly better one but not clearly rejectable). When in doubt → REVIEW, never auto-REJECT.
- REJECT: ONLY for a CLEAR, COMBINED defect — never a single metric alone. Use structured reject_reasons from: CRITICAL_BLUR, FOCUS_FAILURE, EYES_CLOSED, DUPLICATE, LOWER_RANK_IN_BURST, POOR_EXPRESSION, POOR_COMPOSITION, SEVERE_EXPOSURE_FAILURE, OBSTRUCTED_SUBJECT, CORRUPT.
- Never REJECT for low sharpness alone, low exposure alone, or low confidence alone.
- A photo where a KEY face has EYES_CLOSED (mid-blink, fully shut) must NEVER be TOP_PICK or SELECT — use REVIEW (if otherwise good and recoverable) or REJECT (if clearly unusable), and include EYES_CLOSED in reject_reasons.
${singletonRule}

Candidate photo ids: ${idList}. The images are attached in the same order.

Return JSON for this group with: keep_ids (the SELECT+TOP_PICK ids, best first — may be empty ONLY if every photo is REJECT), category (the genre string), reason (short explanation citing faces/eyes/expression and why the TOP_PICK won over the others), and rankings (one object per candidate with id, rank, status, reject_reasons array, the ${SCORE_KEYS.join(', ')} scores, analysis_complete boolean, and a short note).`;
}

function rankingItemSchema(): any {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      rank: { type: 'number' },
      status: { type: 'string', enum: VALID_STATUS },
      reject_reasons: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
      analysis_complete: { type: 'boolean' },
      ...scoreProps(),
    },
    required: ['id', 'rank', 'status', 'reject_reasons', 'overall', 'confidence'],
  };
}

function groupSchemaFor(): any {
  return {
    type: 'object',
    properties: {
      keep_ids: { type: 'array', items: { type: 'string' } },
      category: { type: 'string' },
      reason: { type: 'string' },
      rankings: { type: 'array', items: rankingItemSchema() },
    },
    required: ['keep_ids', 'category', 'reason', 'rankings'],
  };
}

// Selecciona los N mejores candidatos de una mitad por (estado, -overall), excluyendo REJECT.
function pickFinalists(ids: string[], byId: Record<string, any>, n: number): string[] {
  return ids
    .filter((id) => byId[id] && byId[id].status !== 'REJECT')
    .sort((a, b) => {
      const sa = statusRank(byId[a].status);
      const sb = statusRank(byId[b].status);
      if (sa !== sb) return sa - sb;
      return (byId[b].scores?.overall ?? 0) - (byId[a].scores?.overall ?? 0);
    })
    .slice(0, n);
}

// Prompt de la TERCERA llamada: showdown final entre los finalistas de ambas mitades.
// Re-análisis VISUAL; NO compara overall numérico entre mitades (vienen de análisis distintos).
function buildFinalPrompt(ids: string[], byIdAll: Record<string, any>): string {
  const sections = ids.map((id: string, i: number) => {
    const r = byIdAll[id] || {};
    const sc = r.scores || {};
    const scoreLine = Object.entries(sc)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'n/a';
    return `Candidate ${i} (id=${id}): prior status=${r.status || 'REVIEW'}, prior scores: ${scoreLine}. prior note: ${r.note || ''}`;
  }).join('\n');

  return `You are an elite professional photo editor doing the FINAL showdown of a wedding culling sequence. The group was large and split into two halves; these ${ids.length} candidates are the strongest from both halves. Do NOT simply compare the prior numeric scores across halves — they came from separate analyses and are NOT directly comparable. Re-analyze each candidate VISUALLY from the attached images on these dimensions (0-100 each): eyes, expression, focus, moment, composition, interaction, subject_quality, exposure, technical, sharpness, color_quality, overall, confidence. OMIT a dimension only if not applicable (no people → omit eyes/expression/interaction); never use 0 for "not applicable".

Prior context (reference only — re-judge visually, do not trust the numbers across halves):
${sections}

Decide the DEFINITIVE ranking of the whole group:
- TOP_PICK: the single strongest frame (best eyes + expression + moment + composition). At most ONE.
- SELECT: deliverable.
- REVIEW: doubtful.
- REJECT: clear combined defect only.
Priority for people: eyes > expression > moment > focus > composition > technical. A sharper but lifeless/blinked frame must NOT beat a slightly softer frame with genuine emotion and a decisive moment. A photo where a KEY face has EYES_CLOSED must NEVER be TOP_PICK or SELECT — use REVIEW or REJECT.

Return JSON: finalists (array, one entry per candidate id), each with id, rank (1=best), status, reject_reasons, note, and the scores above. Candidate ids in image order: ${ids.join(', ')}.`;
}

// Tercera llamada IA entre finalistas. Devuelve byId de los finalistas re-analizados.
async function analyzeFinalists(base44: any, ids: string[], uploaded: Record<string, string>, byIdAll: Record<string, any>, category: string | null = null): Promise<Record<string, any>> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildFinalPrompt(ids, byIdAll);
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    prompt,
    model: MODEL,
    file_urls: fileUrls,
    response_json_schema: {
      type: 'object',
      properties: { finalists: { type: 'array', items: rankingItemSchema() } },
      required: ['finalists'],
    },
  });
  const arr = Array.isArray(result?.finalists) ? result.finalists : [];
  const out: Record<string, any> = {};
  for (const r of arr) {
    const rid = String(r.id);
    if (ids.includes(rid)) out[rid] = buildRankingEntry(rid, r, category);
  }
  for (const id of ids) {
    if (!out[id]) out[id] = buildRankingEntry(id, {}, category);
  }
  return out;
}

// Fusiona mitades + finalistas en un ranking global único.
function mergeConsolidation(candidateIds: string[], h1: any, h2: any, finals: Record<string, any>): any {
  const byId: Record<string, any> = { ...h1.byId, ...h2.byId };
  for (const id of Object.keys(finals)) byId[id] = finals[id];
  // Un único TOP_PICK global (el de finals). Cualquier otro TOP_PICK → SELECT.
  let globalTop: string | null = null;
  for (const id of Object.keys(finals)) {
    if (finals[id].status === 'TOP_PICK') { globalTop = id; break; }
  }
  for (const id of candidateIds) {
    if (byId[id]?.status === 'TOP_PICK' && globalTop && id !== globalTop) byId[id].status = 'SELECT';
  }
  const order = [...candidateIds].sort((a, b) => {
    const sa = statusRank(byId[a]?.status || 'REVIEW');
    const sb = statusRank(byId[b]?.status || 'REVIEW');
    if (sa !== sb) return sa - sb;
    return (byId[b]?.scores?.overall ?? 0) - (byId[a]?.scores?.overall ?? 0);
  });
  order.forEach((id, i) => { if (byId[id]) byId[id].rank = i + 1; });
  const keep_ids = order.filter((id) => byId[id]?.status === 'SELECT' || byId[id]?.status === 'TOP_PICK');
  const category = h1.category || h2.category || null;
  const reason = h1.reason && h2.reason ? `${h1.reason} / ${h2.reason}` : (h1.reason || h2.reason || null);
  return {
    keep_ids,
    category,
    reason,
    rankings: candidateIds.map((id) => ({ id, ...byId[id] })),
  };
}

// Llama a la IA para un subconjunto de candidatos y devuelve byId + meta del subgrupo.
async function analyzeSubset(base44: any, key: string, ids: string[], uploaded: Record<string, string>, isSingleton: boolean): Promise<any> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildPrompt(ids, isSingleton);
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    prompt,
    model: MODEL,
    file_urls: fileUrls,
    response_json_schema: {
      type: 'object',
      properties: { [key]: groupSchemaFor() },
      required: [key],
    },
  });
  const g = result[key] || {};
  const category = typeof g.category === 'string' ? g.category : null;
  const rankings = Array.isArray(g.rankings) ? g.rankings : [];
  const byId: Record<string, any> = {};
  for (const r of rankings) {
    const rid = String(r.id);
    if (!ids.includes(rid)) continue;
    byId[rid] = buildRankingEntry(rid, r, category);
  }
  for (const id of ids) {
    if (!byId[id]) byId[id] = buildRankingEntry(id, {}, category);
  }
  return {
    byId,
    keep_ids: Array.isArray(g.keep_ids) ? g.keep_ids.map(String).filter((id: string) => ids.includes(id)) : [],
    category,
    reason: typeof g.reason === 'string' ? g.reason : null,
  };
}

// Consolida dos sub-llamadas (mitades) en un único ranking global del grupo.
function consolidateHalves(candidateIds: string[], h1: any, h2: any): any {
  const byId: Record<string, any> = { ...h1.byId, ...h2.byId };
  // Un único TOP_PICK global: el de mayor overall entre los TOP_PICK de ambas mitades.
  let topId: string | null = null;
  let topOverall = -1;
  for (const id of candidateIds) {
    if (byId[id]?.status === 'TOP_PICK') {
      const ov = byId[id].scores?.overall ?? 0;
      if (ov > topOverall) { topOverall = ov; topId = id; }
    }
  }
  for (const id of candidateIds) {
    if (byId[id]?.status === 'TOP_PICK' && id !== topId) byId[id].status = 'SELECT';
  }
  // Ranking global por (estado, -overall).
  const order = [...candidateIds].sort((a, b) => {
    const sa = statusRank(byId[a]?.status || 'REVIEW');
    const sb = statusRank(byId[b]?.status || 'REVIEW');
    if (sa !== sb) return sa - sb;
    return (byId[b]?.scores?.overall ?? 0) - (byId[a]?.scores?.overall ?? 0);
  });
  order.forEach((id, i) => { if (byId[id]) byId[id].rank = i + 1; });
  const keep_ids = order.filter((id) => byId[id]?.status === 'SELECT' || byId[id]?.status === 'TOP_PICK');
  const category = h1.category || h2.category || null;
  const reason = h1.reason && h2.reason ? `${h1.reason} / ${h2.reason}` : (h1.reason || h2.reason || null);
  return {
    keep_ids,
    category,
    reason,
    rankings: candidateIds.map((id) => ({ id, ...byId[id] })),
  };
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

    await runWithConcurrency(bursts, MAX_CONCURRENT_LLM, async (burst: any) => {
      const burstId = String(burst.burst_id);
      const candidates = Array.isArray(burst.photos) ? burst.photos : [];
      const candidateIds = candidates.map((c: any) => String(c.id));
      if (!candidates.length) {
        groups[burstId] = { keep_ids: [], category: null, reason: 'Sin candidatas', rankings: [] };
        return;
      }

      // Métricas técnicas de Pass 1 (para fallback).
      const technicals: Record<string, any> = {};
      for (const c of candidates) {
        const id = String(c.id);
        technicals[id] = c.technical || { corrupt: !c.preview_base64 };
      }

      let iaCalls = 0;
      let finalistIds: string[] = [];
      let finalRan = false;

      try {
        const uploaded = await uploadPreviewBatch(
          base44,
          candidates.map((c: any) => ({ id: String(c.id), previewBase64: String(c.preview_base64) }))
        );

        let result: any;
        if (candidateIds.length <= MAX_IMAGES_PER_CALL) {
          iaCalls = 1;
          const isSingleton = candidateIds.length === 1;
          const sub = await analyzeSubset(base44, `group_0`, candidateIds, uploaded, isSingleton);
          result = {
            keep_ids: sub.keep_ids,
            category: sub.category,
            reason: sub.reason,
            rankings: candidateIds.map((id) => ({ id, ...sub.byId[id] })),
          };
        } else {
          // Grupo grande: dos llamadas comparativas (mitades) + TERCERA llamada de
          // consolidación entre los mejores finalistas de cada mitad (re-análisis visual).
          // Si la tercera llamada falla o hay <2 finalistas, cae a consolidación
          // determinista (consolidateHalves) como red de seguridad.
          iaCalls = 2;
          const mid = Math.ceil(candidateIds.length / 2);
          const h1Ids = candidateIds.slice(0, mid);
          const h2Ids = candidateIds.slice(mid);
          const [h1, h2] = await Promise.all([
            analyzeSubset(base44, `group_0`, h1Ids, uploaded, false),
            analyzeSubset(base44, `group_1`, h2Ids, uploaded, false),
          ]);
          const f1 = pickFinalists(h1Ids, h1.byId, FINALISTS_PER_HALF);
          const f2 = pickFinalists(h2Ids, h2.byId, FINALISTS_PER_HALF);
          finalistIds = [...f1, ...f2];
          if (finalistIds.length >= 2) {
            try {
              const finals = await analyzeFinalists(base44, finalistIds, uploaded, { ...h1.byId, ...h2.byId }, h1.category || h2.category || null);
              finalRan = true;
              iaCalls = 3;
              result = mergeConsolidation(candidateIds, h1, h2, finals);
            } catch (e: any) {
              result = consolidateHalves(candidateIds, h1, h2);
            }
          } else {
            result = consolidateHalves(candidateIds, h1, h2);
          }
        }

        // Validación de keep_ids: solo ids válidos; a lo sumo un TOP_PICK (ya garantizado).
        let keepIds = (result.keep_ids || []).filter((id: string) => candidateIds.includes(id));
        if (!keepIds.length) {
          keepIds = candidateIds.filter((id) => {
            const st = result.rankings.find((r: any) => r.id === id)?.status;
            return st === 'SELECT' || st === 'TOP_PICK';
          });
        }
        // A lo sumo un TOP_PICK (seguridad ante respuestas que marcan varios).
        let topId: string | null = null;
        let topOverall = -1;
        for (const r of result.rankings) {
          if (r.status === 'TOP_PICK') {
            const ov = r.scores?.overall ?? 0;
            if (ov > topOverall) { topOverall = ov; topId = r.id; }
          }
        }
        const rankings = result.rankings.map((r: any) => {
          if (r.status === 'TOP_PICK' && topId && r.id !== topId) return { ...r, status: 'SELECT' };
          return r;
        });

        groups[burstId] = {
          keep_ids: keepIds,
          category: result.category,
          reason: result.reason,
          rankings,
          _meta: { ia_calls: iaCalls, finalist_ids: finalistIds, final_ran: finalRan, fallback: false },
        };
      } catch (e: any) {
        // Fallback técnico conservador (no simula decisión IA).
        groups[burstId] = { ...technicalFallback(candidateIds, technicals), _meta: { ia_calls: 0, finalist_ids: [], final_ran: false, fallback: true } };
      }
    });

    return Response.json({ groups });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}