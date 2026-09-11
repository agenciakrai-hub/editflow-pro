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
// Modelo de visión: el configurado por el administrador (active_seleccion /
// active_model_seleccion) vía aiProviderAdapter — NO hay modelo fijo en el código.
// Sin add_context_from_internet (privacidad de previews). Concurrencia controlada
// (MAX_CONCURRENT_LLM=3).
//
// Grupos grandes: si el grupo supera MAX_IMAGES_PER_CALL, se parte en DOS llamadas
// comparativas que cubren todo el grupo (ninguna foto queda fuera por sharpness/
// exposure) y se consolida el ranking deterministamente (un único TOP_PICK global).

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
  const conf = typeof scores.confidence === 'number' ? scores.confidence : null;
  let confidence_tier = "UNCERTAIN_REVIEW";
  if (status === "TOP_PICK" || status === "SELECT") {
    if (conf !== null && conf >= 70) confidence_tier = "HIGH_CONFIDENCE_SELECT";
  } else if (status === "REJECT") {
    if (conf !== null && conf >= 70) confidence_tier = "HIGH_CONFIDENCE_REJECT";
  }
  return {
    id,
    rank: typeof r?.rank === 'number' ? r.rank : 999,
    status,
    reject_reasons: Array.isArray(r?.reject_reasons) ? r.reject_reasons : [],
    note: typeof r?.note === 'string' ? r.note : '',
    scores,
    confidence_tier,
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
    ? `\nSINGLETON: this group has a SINGLE photo. There is no comparison to make — assess it on its own merits. It can be TOP_PICK/SELECT if clearly good, REVIEW if genuinely doubtful, or REJECT if clearly unusable (critical blur + missed focus, severe exposure failure, corrupt) or clearly not worth delivering. Do NOT force a SELECT just because it is alone, and do NOT default to REVIEW a photo you are confident is bad — REJECT it.`
    : `\nGUARANTEE for multi-photo groups: rank every candidate (rank 1 = best). At most ONE TOP_PICK. If at least one photo is clearly deliverable, mark the best as TOP_PICK or SELECT. If ALL are genuinely rejectable (clearly inferior or clearly defective), return only REJECT — do not fabricate a SELECT. When in doubt between two near-equal frames, prefer the one with better eyes/expression/moment over the one with marginally higher sharpness.`;

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
- confidence: 0-100 how sure you are of THIS photo's assessment. Use >=70 for decisions you are confident about (clear SELECT or clear REJECT), <60 for genuine uncertainty (REVIEW).

STEP 4 — Decide COMPARATIVELY (relative ranking inside this group). Separate clear decisions from doubtful ones using your confidence:
- TOP_PICK: the single strongest frame (best faces + moment + composition). At most ONE.
- SELECT: a clearly good, deliverable frame you are confident about.
- REJECT: a frame you are confident is NOT worth keeping. This is NOT limited to technical defects — REJECT whenever you are confident the photo is clearly inferior or redundant within this group: clearly worse expression/moment/eyes than a clearly better alternative in the same burst, a near-duplicate that adds nothing, OR a clear combined technical defect. Use structured reject_reasons from: CRITICAL_BLUR, FOCUS_FAILURE, EYES_CLOSED, DUPLICATE, LOWER_RANK_IN_BURST, POOR_EXPRESSION, POOR_COMPOSITION, SEVERE_EXPOSURE_FAILURE, OBSTRUCTED_SUBJECT, CORRUPT, CLEARLY_INFERIOR_IN_BURST, REDUNDANT_IN_BURST.
- REVIEW: ONLY when you are genuinely uncertain — a near-tie where two frames are close enough that the choice is subjective, a recoverable borderline (slight focus/expression doubt) that is not clearly rejectable, or low confidence in either direction. REVIEW means "the photographer should decide". Do NOT use REVIEW as the default for everything you did not SELECT: if you are confident a frame is clearly worse, REJECT it.
- A photo where a KEY face has EYES_CLOSED (mid-blink, fully shut) must NEVER be TOP_PICK or SELECT — REJECT it if a clearly better alternative exists in the burst, otherwise REVIEW. Include EYES_CLOSED in reject_reasons.
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

Decide the DEFINITIVE ranking of the whole group. Separate clear decisions from doubtful ones using your confidence:
- TOP_PICK: the single strongest frame (best eyes + expression + moment + composition). At most ONE.
- SELECT: a clearly good, deliverable frame you are confident about.
- REVIEW: ONLY when genuinely uncertain (near-tie, borderline). Do NOT default to REVIEW a frame you are confident is clearly worse.
- REJECT: a frame you are confident is NOT worth keeping — clearly inferior to a better finalist, redundant, or a clear combined defect.
Priority for people: eyes > expression > moment > focus > composition > technical. A sharper but lifeless/blinked frame must NOT beat a slightly softer frame with genuine emotion and a decisive moment. A photo where a KEY face has EYES_CLOSED must NEVER be TOP_PICK or SELECT — REJECT if a clearly better finalist exists, otherwise REVIEW.

Return JSON: finalists (array, one entry per candidate id), each with id, rank (1=best), status, reject_reasons, note, and the scores above. Candidate ids in image order: ${ids.join(', ')}.`;
}

// Tercera llamada IA entre finalistas. Devuelve byId de los finalistas re-analizados.
async function analyzeFinalists(base44: any, ids: string[], uploaded: Record<string, string>, byIdAll: Record<string, any>, category: string | null = null, trace?: any): Promise<Record<string, any>> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildFinalPrompt(ids, byIdAll);
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    prompt,
    file_urls: fileUrls,
    response_json_schema: {
      type: 'object',
      properties: { finalists: { type: 'array', items: rankingItemSchema() } },
      required: ['finalists'],
    },
    _trace: trace,
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
async function analyzeSubset(base44: any, key: string, ids: string[], uploaded: Record<string, string>, isSingleton: boolean, trace?: any): Promise<any> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildPrompt(ids, isSingleton);
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    prompt,
    file_urls: fileUrls,
    response_json_schema: {
      type: 'object',
      properties: { [key]: groupSchemaFor() },
      required: [key],
    },
    _trace: trace,
  });
  // CORRECCIÓN (bug culling): el proveedor activo (custom/Gemini) NO recibe
  // response_json_schema (el adaptador custom lo omite) y el prompt pide el JSON del
  // grupo en la RAÍZ ({keep_ids, category, reason, rankings}). Antes solo se leía
  // result['group_0'] (envoltorio que únicamente imponía InvokeLLM): con Gemini la
  // clave no existía → g={} → TODAS las fotos caían al default REVIEW y la decisión
  // real de la IA (SELECT/REJECT incluidos) se descartaba en silencio. Se aceptan
  // AMBAS formas: envuelta (schema) o raíz (prompt).
  const g = (result && typeof result === 'object' && result[key]) ? result[key] : (result || {});
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

// Lote de fotos sueltas (singletons de escenas distintas). La IA juzga CADA foto por su
// mérito propio, sin compararlas ni ranking entre ellas. Reduce N llamadas (una por
// foto) a N/INDEPENDENT_MAX. category=null: género mixto → guard conservador (el modelo
// devuelve null en dimensiones faciales no aplicables).
const INDEPENDENT_MAX = 6;

function buildIndependentPrompt(ids: string[]): string {
  return `You are an elite professional photo editor assessing ${ids.length} photos INDIVIDUALLY. These photos come from DIFFERENT moments and scenes — do NOT compare or rank them against each other. Judge each one on its own merits.

STEP 1 — For each photo, classify its genre (portrait, wedding, event, group, architecture, interior, landscape, product, lifestyle, documentary).

STEP 2 — For each photo, analyze independently across ALL dimensions. Each score is 0-100, or null when NOT APPLICABLE (no people → face_quality, eye_quality, expression = null). NEVER return 0 to mean "not applicable" — return null. Return 0 only for a genuinely evaluated, critically bad dimension:
- technical: file integrity, noise, artifacts, capture problems
- sharpness: global sharpness
- focus: is the SUBJECT in sharp focus? Distinguish artistic background blur from accidental subject blur.
- face_quality: if people present, face visibility/quality. No people → null.
- eye_quality: eyes open vs closed for every visible face. No people → null.
- expression: natural/emotive vs awkward. No people → null.
- composition: balance, framing, lines, distracting elements, awkward crops
- exposure: tonal distribution, clipping, severe over/underexposure
- color_quality: white balance, color cast, skin tones
- subject_quality: clarity/presence of the main subject
- moment_quality: decisive moment, emotion, interaction (people/events); stillness/cleanliness for architecture/landscape
- distraction_penalty: HIGHER = cleaner (100 = no distractions, 0 = very distracting). Inverted scale.
- overall: your composite judgment WEIGHTED BY GENRE
- confidence: 0-100 how sure you are of THIS photo's assessment. Use >=70 for decisions you are confident about (clear SELECT or clear REJECT), <60 for genuine uncertainty (REVIEW).

STEP 3 — Decide INDEPENDENTLY for each photo (no comparison, no single-TOP_PICK limit):
- TOP_PICK: an exceptional, clearly deliverable frame.
- SELECT: a clearly good, deliverable frame you are confident about.
- REVIEW: ONLY when you are genuinely uncertain (borderline faces/exposure, low confidence in either direction). Do NOT default to REVIEW a photo you are confident is bad.
- REJECT: a frame you are confident is clearly not worth keeping — a clear combined technical defect, or clearly not deliverable. Use reject_reasons from: CRITICAL_BLUR, FOCUS_FAILURE, EYES_CLOSED, POOR_EXPRESSION, POOR_COMPOSITION, SEVERE_EXPOSURE_FAILURE, OBSTRUCTED_SUBJECT, CORRUPT, CLEARLY_NOT_DELIVERABLE.
Multiple photos can be TOP_PICK or SELECT; none need to be. Set rank to 1 for every photo.

Candidate photo ids: ${ids.join(', ')}. The images are attached in the same order.

Return JSON: keep_ids (all SELECT+TOP_PICK ids), category (dominant genre or null), reason (short), and rankings (one object per candidate with id, rank (always 1), status, reject_reasons, note, analysis_complete, and the ${SCORE_KEYS.join(', ')} scores).`;
}

async function analyzeIndependent(base44: any, key: string, ids: string[], uploaded: Record<string, string>, trace?: any): Promise<any> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildIndependentPrompt(ids);
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    prompt,
    file_urls: fileUrls,
    response_json_schema: {
      type: 'object',
      properties: { [key]: groupSchemaFor() },
      required: [key],
    },
    _trace: trace,
  });
  // CORRECCIÓN (bug culling, mismo defecto que analyzeSubset): el proveedor custom
  // devuelve el JSON del grupo en la RAÍZ, no envuelto en la clave del schema. Se
  // aceptan ambas formas para no perder la decisión real de la IA.
  const g = (result && typeof result === 'object' && result[key]) ? result[key] : (result || {});
  const rankings = Array.isArray(g.rankings) ? g.rankings : [];
  const byId: Record<string, any> = {};
  for (const r of rankings) {
    const rid = String(r.id);
    if (!ids.includes(rid)) continue;
    byId[rid] = buildRankingEntry(rid, r, null);
    byId[rid].rank = 1; // independent: sin ranking comparativo
  }
  for (const id of ids) {
    if (!byId[id]) byId[id] = buildRankingEntry(id, {}, null);
  }
  return {
    byId,
    keep_ids: Array.isArray(g.keep_ids) ? g.keep_ids.map(String).filter((id: string) => ids.includes(id)) : [],
    category: null,
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
      const trace: any = {};

      try {
        const tUpload0 = Date.now();
        const uploaded = await uploadPreviewBatch(
          base44,
          candidates.map((c: any) => ({ id: String(c.id), previewBase64: String(c.preview_base64) })),
          "seleccion"
        );
        const uploadMs = Date.now() - tUpload0;

        let result: any;
        if (burst.independent) {
          // Lote de singletons: cada foto juzgada por mérito propio, sin límite de un
          // único TOP_PICK (varias pueden ser TOP_PICK/SELECT independientemente).
          iaCalls = 1;
          const sub = await analyzeIndependent(base44, `group_0`, candidateIds, uploaded, trace);
          result = {
            keep_ids: sub.keep_ids,
            category: sub.category,
            reason: sub.reason,
            rankings: candidateIds.map((id) => ({ id, ...sub.byId[id] })),
          };
        } else if (candidateIds.length <= MAX_IMAGES_PER_CALL) {
          iaCalls = 1;
          const isSingleton = candidateIds.length === 1;
          const sub = await analyzeSubset(base44, `group_0`, candidateIds, uploaded, isSingleton, trace);
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
            analyzeSubset(base44, `group_0`, h1Ids, uploaded, false, trace),
            analyzeSubset(base44, `group_1`, h2Ids, uploaded, false, trace),
          ]);
          const f1 = pickFinalists(h1Ids, h1.byId, FINALISTS_PER_HALF);
          const f2 = pickFinalists(h2Ids, h2.byId, FINALISTS_PER_HALF);
          finalistIds = [...f1, ...f2];
          if (finalistIds.length >= 2) {
            try {
              const finals = await analyzeFinalists(base44, finalistIds, uploaded, { ...h1.byId, ...h2.byId }, h1.category || h2.category || null, trace);
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
        // A lo sumo un TOP_PICK (seguridad ante respuestas que marcan varios). En modo
        // independent cada foto se juzga por mérito propio: NO se aplica el límite de un
        // único TOP_PICK (varias fotos pueden ser TOP_PICK/SELECT independientemente).
        let rankings = result.rankings;
        if (!burst.independent) {
          let topId: string | null = null;
          let topOverall = -1;
          for (const r of result.rankings) {
            if (r.status === 'TOP_PICK') {
              const ov = r.scores?.overall ?? 0;
              if (ov > topOverall) { topOverall = ov; topId = r.id; }
            }
          }
          rankings = result.rankings.map((r: any) => {
            if (r.status === 'TOP_PICK' && topId && r.id !== topId) return { ...r, status: 'SELECT' };
            return r;
          });
        }

        groups[burstId] = {
          keep_ids: keepIds,
          category: result.category,
          reason: result.reason,
          rankings,
          _meta: {
            ia_calls: iaCalls, finalist_ids: finalistIds, final_ran: finalRan, fallback: false,
            provider: trace.provider || null, model: trace.model || null,
            active_provider: trace.active_provider ?? null,
            configured_model: trace.configured_model ?? null,
            final_provider: trace.final_provider ?? null,
            final_model: trace.final_model ?? null,
            provider_failover: !!trace.failover,
            failover_reason: trace.failover_reason ?? null,
            attempts: Array.isArray(trace.attempts) ? trace.attempts : [],
            upload_ms: uploadMs,
            request_ms: trace.request_ms ?? null,
            base64_convert_ms: trace.base64_convert_ms ?? null,
            parse_ms: trace.parse_ms ?? null,
            http_status: trace.http_status ?? null,
            tokens_in: trace.tokens_in ?? null,
            tokens_out: trace.tokens_out ?? null,
            endpoint: trace.endpoint ?? null,
          },
        };
      } catch (e: any) {
        // Fallback técnico conservador (no simula decisión IA). Se registra el motivo
        // para que la traza/logs permitan auditar POR QUÉ falló la IA del burst.
        console.log(`[rawAiSmartSelect] burst=${burstId} fallo de IA: ${String(e?.message || e)}`);
        groups[burstId] = { ...technicalFallback(candidateIds, technicals), _meta: { ia_calls: 0, finalist_ids: [], final_ran: false, fallback: true, provider: null, model: null, active_provider: trace.active_provider ?? null, configured_model: trace.configured_model ?? null, final_provider: null, final_model: null, provider_failover: false, failover_reason: String(e?.message || e).slice(0, 300), attempts: Array.isArray(trace.attempts) ? trace.attempts : [], upload_ms: null, request_ms: null, base64_convert_ms: null, parse_ms: null, http_status: null, tokens_in: null, tokens_out: null, endpoint: null, error: String(e?.message || e).slice(0, 300) } };
      }
    });

    return Response.json({ groups });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}