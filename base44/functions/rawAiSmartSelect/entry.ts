import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { uploadPreviewBatch } from '../../shared/rawAiStudioEngine.ts';
import { runWithConcurrency } from '../../shared/concurrency.ts';
import { invokeVision } from '../../shared/aiProviderAdapter.ts';
import { DEFAULT_PROBE_IMAGE, webSession } from '../../shared/providerDefaults.ts';

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
// Concurrencia de LLM aumentada: más ráfagas procesadas en paralelo dentro de cada
// petición HTTP. Los VLM externos (Qwen/NVIDIA/Gemini) toleran 5 llamadas concurrentes
// sin rate-limit; InvokeLLM (base44) también lo permite.
const MAX_CONCURRENT_LLM = 1;
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
      type: ['number', 'null'],
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

const POSE_HEADS = ['front', 'three-quarter-left', 'left-profile', 'three-quarter-right', 'right-profile', 'back', 'unknown'];
const SELECTION_POLICY = `
FINAL POLICY (overrides conflicting rules above): Preserve one representative of EVERY burst even if all images are dark, blurred or eyes closed. Choose by open eyes and natural expression, then focus and moment. Other usable alternatives are REVIEW; clearly unusable/redundant frames are REJECT. In EACH ranking return pose_heads: an array of head orientations for the main subjects in stable left-to-right order. Use ONLY front, three-quarter-left, left-profile, three-quarter-right, right-profile, back, unknown. Use [] if there are no people. Head turns change this key, but hair movement, steps, clothing, smiles, blinks and small gaze changes MUST NOT create new poses. Never add descriptive suffixes or subject names to these fixed values. A head turn creates a different pose group even if the background and position do not change. Do not label a pose change as a duplicate. Use unknown only if orientation cannot be assessed. For singletons retain the photo and report its defects honestly. Never invent visible facial details.`;

const VALID_STATUS = ['TOP_PICK', 'SELECT', 'REVIEW', 'REJECT'];

function buildRankingEntry(id: string, r: any, category: string | null = null): any {
  const status = VALID_STATUS.includes(r?.status) ? r.status : 'REVIEW';
  const scores: Record<string, number | null> = {};
  for (const k of SCORE_KEYS) scores[k] = normScore(r?.[k]) ?? normScore(r?.scores?.[k]);
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
  const faceVisibility = ['visible','not_visible','no_people','uncertain'].includes(r?.face_visibility) ? r.face_visibility : null;
  const unavailableFaces = faceVisibility && faceVisibility !== 'visible';
  const applicableMissing = applicableDims(category).filter((k) => scores[k] === null && !(unavailableFaces && PERSON_DIMS.includes(k as any)));
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
    face_visibility: faceVisibility,
    pose_key: Array.isArray(r?.pose_heads) && r.pose_heads.every((head: string) => POSE_HEADS.includes(head))
      ? (r.pose_heads.length ? r.pose_heads.join('|') : 'no-people')
      : typeof r?.pose_key === 'string' && r.pose_key.split('|').every((head: string) => POSE_HEADS.includes(head)) ? r.pose_key : null,
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
  return `You are a professional wedding and event photo editor. Compare these ${ids.length} photos as a burst. Images are attached in exactly this order: ${ids.join(', ')}.

Return ONE JSON object at the root: {keep_ids, category, reason, rankings}.
category: portrait, wedding, event, group, architecture, interior, landscape, product, lifestyle or documentary.
rankings MUST contain exactly one object for EACH supplied id, in image order. Each object must contain id, rank (1=best), status (TOP_PICK/SELECT/REVIEW/REJECT), reject_reasons (array), note (one short sentence), pose_heads, face_visibility and ALL numeric score keys: ${SCORE_KEYS.join(', ')}. Put the scores directly on each ranking, not in a separate object. Scores are 0-100; distraction_penalty is 100 for no distractions. Always provide every non-facial score, overall and confidence. Use null for face_quality, eye_quality and expression ONLY if faces cannot be assessed; set face_visibility to visible, not_visible, no_people or uncertain accordingly. Do not invent hidden eyes or expressions.

Priority: open eyes of the main subjects and natural expression, then subject focus, moment, composition and exposure. Artistic background blur is not subject defocus. Preserve a representative even if the whole burst is dark or blurred; report the defects honestly. For groups choose the best visible combination of eyes and expressions. Choose ONE strongest frame as TOP_PICK; other usable alternatives are REVIEW, clearly inferior duplicates/combined defects REJECT. A blink should lose to a comparable open-eye frame. Head turns create different poses; do not discard a new head pose as a duplicate. All-black frames still get a ranking and honest low scores. ${isSingleton ? 'This is a singleton: retain it and describe its defects.' : ''}

pose_heads: fixed orientations per main subject in stable left-to-right order, using front, three-quarter-left, left-profile, three-quarter-right, right-profile, back, unknown; [] if no people. Small gaze changes, smiles, blinks, hair and clothing do not create new poses. Return concise JSON only; no markdown or chain of thought.`;
}

function rankingItemSchema(): any {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      face_visibility: { type: 'string', enum: ['visible','not_visible','no_people','uncertain'] },
      pose_key: { type: 'string' },
      pose_heads: { type: 'array', items: { type: 'string', enum: POSE_HEADS } },
      rank: { type: 'number' },
      status: { type: 'string', enum: VALID_STATUS },
      reject_reasons: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
      analysis_complete: { type: 'boolean' },
      ...scoreProps(),
    },
    required: ['id', 'rank', 'status', 'reject_reasons', 'pose_heads', 'overall', 'confidence'],
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

  return `You are an elite professional photo editor doing the FINAL showdown of a wedding culling sequence. The group was large and split into two halves; these ${ids.length} candidates are the strongest from both halves. Do NOT simply compare the prior numeric scores across halves — they came from separate analyses and are NOT directly comparable. Re-analyze each candidate VISUALLY from the attached images on these dimensions (0-100 each): ${SCORE_KEYS.join(', ')}. OMIT a dimension only if not applicable (no people → omit eyes/expression/interaction); never use 0 for "not applicable".

Prior context (reference only — re-judge visually, do not trust the numbers across halves):
${sections}

Decide the DEFINITIVE ranking of the whole group. Separate clear decisions from doubtful ones using your confidence:
- TOP_PICK: the single strongest frame (best eyes + expression + moment + composition). At most ONE.
- SELECT: a clearly good, deliverable frame you are confident about.
- REVIEW: ONLY when genuinely uncertain (near-tie, borderline). Do NOT default to REVIEW a frame you are confident is clearly worse.
- REJECT: a frame you are confident is NOT worth keeping — clearly inferior to a better finalist, redundant, or a clear combined defect.
Priority for people: eyes > expression > moment > focus > composition > technical. A sharper but lifeless/blinked frame must NOT beat a slightly softer frame with genuine emotion and a decisive moment. A photo where a KEY face has EYES_CLOSED must NEVER be TOP_PICK or SELECT — REJECT if a clearly better finalist exists, otherwise REVIEW.

Return JSON: finalists (array, one entry per candidate id), each with id, rank (1=best), status, reject_reasons, note, pose_heads and ALL the exact numeric score keys listed above (put them directly in each finalist, using their exact names). Do not nest a finalist inside another group. Candidate ids in image order: ${ids.join(', ')}.`;
}

// Tercera llamada IA entre finalistas. Devuelve byId de los finalistas re-analizados.
async function analyzeFinalists(base44: any, ids: string[], uploaded: Record<string, string>, byIdAll: Record<string, any>, category: string | null = null, trace?: any, overrides: any = {}): Promise<Record<string, any>> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildFinalPrompt(ids, byIdAll) + SELECTION_POLICY + '\nReturn face_visibility per finalist: visible, not_visible, no_people or uncertain. Only unassessable facial dimensions may be null; all non-facial scores, overall and confidence are required.';
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    ...overrides,
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
    if (!out[id] || !out[id].analysis_complete) throw new Error('Comparación final incompleta: faltan candidatas o puntuaciones requeridas');
  }
  return out;
}

// Fusiona mitades + finalistas en un ranking global único.
function mergeConsolidation(candidateIds: string[], h1: any, h2: any, finals: Record<string, any>): any {
  const byId: Record<string, any> = { ...h1.byId, ...h2.byId };
  for (const id of Object.keys(finals)) byId[id] = { ...finals[id], pose_key: finals[id].pose_key || byId[id]?.pose_key || null };
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
async function analyzeSubset(base44: any, key: string, ids: string[], uploaded: Record<string, string>, isSingleton: boolean, trace?: any, overrides: any = {}): Promise<any> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildPrompt(ids, isSingleton) + SELECTION_POLICY;
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    ...overrides,
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
    if (!byId[id] || !byId[id].analysis_complete) throw new Error('Análisis visual incompleto: el proveedor no evaluó todas las fotos y sus puntuaciones');
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
  return buildPrompt(ids, true) + `\nINDEPENDENT SINGLETONS: these images are NOT one burst and must NOT be compared. Each id is the only representative of its own scene: keep EVERY id, rank=1 for each, status=SELECT with its honest defects and confidence. Never reject an image as a duplicate of another scene. Return face_visibility and the exact complete score contract above for EVERY id.\n`;
}

async function analyzeIndependent(base44: any, key: string, ids: string[], uploaded: Record<string, string>, trace?: any, overrides: any = {}): Promise<any> {
  const fileUrls = ids.map((id) => uploaded[id]).filter(Boolean);
  const prompt = buildIndependentPrompt(ids) + SELECTION_POLICY;
  const result: any = await invokeVision(base44, {
    task: 'seleccion',
    ...overrides,
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
    if (!byId[id] || !byId[id].analysis_complete) throw new Error('Análisis individual incompleto: el proveedor no evaluó todas las fotos y sus puntuaciones');
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
    let bursts = Array.isArray(body?.bursts) ? body.bursts : [];
    let overrides: any = {};
    const audit = body?.action === 'audit-selection';
    if (audit) {
      if (user.role !== 'admin') return Response.json({error:'Forbidden'}, {status:403});
      const rec: any = await base44.asServiceRole.entities.CustomAiProvider.get(String(body.id || '')).catch(()=>null);
      const model = String(body.model || '');
      if (!rec?.enabled || webSession(rec) || !rec.seleccion_models?.includes(model) || !(rec.available_models_meta || []).some((m:any)=>m.id===model && m.caps?.vision===true)) {
        return Response.json({error:'La auditoría requiere un modelo API activo, marcado y verificado. Las sesiones web se revisan por separado.'}, {status:400});
      }
      overrides = { forceProvider: `custom:${rec.id}`, forceModel: model };
      bursts = [{ burst_id:'audit-six', photos:Array.from({length:6},(_,i)=>({id:`audit-${i+1}`,preview_base64:DEFAULT_PROBE_IMAGE.split(',')[1]})) }];
    }
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
      const burstStarted = Date.now();

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
          const sub = await analyzeIndependent(base44, `group_0`, candidateIds, uploaded, trace, overrides);
          result = {
            keep_ids: sub.keep_ids,
            category: sub.category,
            reason: sub.reason,
            rankings: candidateIds.map((id) => ({ id, ...sub.byId[id] })),
          };
        } else if (candidateIds.length <= MAX_IMAGES_PER_CALL) {
          iaCalls = 1;
          const isSingleton = candidateIds.length === 1;
          const sub = await analyzeSubset(base44, `group_0`, candidateIds, uploaded, isSingleton, trace, overrides);
          result = {
            keep_ids: sub.keep_ids,
            category: sub.category,
            reason: sub.reason,
            rankings: candidateIds.map((id) => ({ id, ...sub.byId[id] })),
          };
        } else {
          // Grupo grande: dos llamadas comparativas (mitades) + TERCERA llamada de
          // consolidación entre los mejores finalistas de cada mitad (re-análisis visual).
          // Una comparación final incompleta se informa como fallo: no se guarda
          // como selección válida. Sin suficientes finalistas se consolidan las mitades.
          iaCalls = 2;
          const mid = Math.ceil(candidateIds.length / 2);
          const h1Ids = candidateIds.slice(0, mid);
          const h2Ids = candidateIds.slice(mid);
          const h1 = await analyzeSubset(base44, `group_0`, h1Ids, uploaded, false, trace, overrides);
          const h2 = await analyzeSubset(base44, `group_1`, h2Ids, uploaded, false, trace, overrides);
          const f1 = pickFinalists(h1Ids, h1.byId, FINALISTS_PER_HALF);
          const f2 = pickFinalists(h2Ids, h2.byId, FINALISTS_PER_HALF);
          finalistIds = [...f1, ...f2];
          if (finalistIds.length >= 2) {
            try {
              const finals = await analyzeFinalists(base44, finalistIds, uploaded, { ...h1.byId, ...h2.byId }, h1.category || h2.category || null, trace, overrides);
              finalRan = true;
              iaCalls = 3;
              result = mergeConsolidation(candidateIds, h1, h2, finals);
            } catch (e: any) {
              throw new Error(`No se pudo completar la comparación final: ${e?.message || e}`);
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
            total_ms: Date.now() - burstStarted,
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
        groups[burstId] = { ...technicalFallback(candidateIds, technicals), _meta: { total_ms: Date.now() - burstStarted, ia_calls: iaCalls, finalist_ids: [], final_ran: false, fallback: true, provider: trace.provider || trace.active_provider || null, model: trace.model || null, active_provider: trace.active_provider ?? null, configured_model: trace.configured_model ?? null, final_provider: null, final_model: null, provider_failover: false, failover_reason: String(e?.message || e).slice(0, 300), attempts: Array.isArray(trace.attempts) ? trace.attempts : [], upload_ms: null, request_ms: trace.request_ms ?? null, base64_convert_ms: trace.base64_convert_ms ?? null, parse_ms: trace.parse_ms ?? null, http_status: trace.http_status ?? null, tokens_in: trace.tokens_in ?? null, tokens_out: trace.tokens_out ?? null, endpoint: null, error: String(e?.message || e).slice(0, 300) } };
      }
    });

    return Response.json({ groups });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}