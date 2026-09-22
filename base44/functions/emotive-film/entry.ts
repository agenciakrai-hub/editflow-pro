// Emotive Film IA — backend function.
// Acciones (auth requerida):
//   analyze-batch   — VLM analiza un lote de fotos (emoción, personas, escena, calidad).
//   identify-couple — VLM identifica a la pareja protagonista desde una muestra.
//   plan-film       — LLM genera el Film Plan desde la base de datos de fotos + música.
//
// Reutiliza aiProviderAdapter.invokeVision (mismo proveedor activo de Selección IA).
// Las previews viajan como data URLs base64 (local-first: los RAW nunca se suben).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.49";
import { invokeVision } from "../../shared/aiProviderAdapter.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = body.action;

    if (action === "analyze-batch") return await doAnalyzeBatch(base44, body);
    if (action === "identify-couple") return await doIdentifyCouple(base44, body);
    if (action === "plan-film") return await doPlanFilm(base44, body);

    return Response.json({ error: "Acción no soportada: " + action }, { status: 400 });
  } catch (error) {
    console.error("emotive-film error", error?.message || error);
    return Response.json({ error: error?.message || "Error interno" }, { status: 500 });
  }
}

// analyze-batch: recibe un lote de fotos con preview_base64 (data URL). El VLM analiza
// cada foto y devuelve scores de emoción, calidad, personas, escena y descripción.
// photos: [{ fingerprint_hash, preview_base64 }]
// → { results: [{ fingerprint_hash, emotion_score, quality_score, people_score, has_couple, scene, description }] }
async function doAnalyzeBatch(base44, body) {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) return Response.json({ error: "No hay fotos que analizar" }, { status: 400 });

  const prompt = `Eres un editor de vídeo profesional especializado en bodas. Analiza cada fotografía para un vídeo emocional de boda. Para CADA foto, evalúa:

- emotion_score (0-100): fuerza emocional (miradas, gestos, risas, lágrimas, abrazos, besos, momentos espontáneos).
- quality_score (0-100): calidad fotográfica (composición, luz, nitidez, momento decisivo).
- people_score (0-100): protagonismo de personas y conexión entre ellas.
- has_couple (boolean): ¿parece ser la pareja protagonista (novios)?
- scene (string): una de: "preparativos", "novia", "novio", "familia", "ceremonia", "anillos", "beso", "pareja", "retratos", "amigos", "celebracion", "banquete", "baile", "fiesta", "detalle", "otros".
- description (string): descripción breve en español del contenido (máx 120 caracteres).

Devuelve un JSON con un array "results" con una entrada por foto en el mismo orden. Una foto emocionalmente potente puede tener emotion_score alto aunque quality_score sea medio.`;

  const file_urls = photos.map((p) => `data:image/jpeg;base64,${p.preview_base64}`);
  const trace = {};
  const res = await invokeVision(base44, {
    task: "seleccion",
    prompt,
    file_urls,
    response_json_schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              fingerprint_hash: { type: "string" },
              emotion_score: { type: "number" },
              quality_score: { type: "number" },
              people_score: { type: "number" },
              has_couple: { type: "boolean" },
              scene: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
    _trace: trace,
  });

  // invokeVision devuelve el JSON parseado (o el resultado de InvokeLLM).
  const results = Array.isArray(res?.results) ? res.results : [];
  // Asegura que cada resultado tenga su fingerprint_hash (el modelo a veces los omite).
  const out = results.map((r, i) => ({
    fingerprint_hash: r?.fingerprint_hash || photos[i]?.fingerprint_hash || "",
    emotion_score: Number(r?.emotion_score) || 0,
    quality_score: Number(r?.quality_score) || 0,
    people_score: Number(r?.people_score) || 0,
    has_couple: !!r?.has_couple,
    scene: String(r?.scene || "otros").toLowerCase(),
    description: String(r?.description || "").slice(0, 200),
  }));
  return Response.json({ results: out, trace });
}

// identify-couple: recibe una muestra de fotos (las que tienen has_couple=true o una
// muestra aleatoria). El VLM identifica qué fotos muestran a la MISMA pareja de forma
// repetida (los protagonistas). Devuelve los fingerprint_hashes de la pareja.
// photos: [{ fingerprint_hash, preview_base64 }]
// → { couple_hashes: [string], confidence: number }
async function doIdentifyCouple(base44, body) {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) return Response.json({ couple_hashes: [], confidence: 0 });

  const prompt = `Eres un experto en reconocimiento de protagonistas de boda. Se te muestran varias fotografías. Identifica a la PAREJA protagonista (los novios): las personas que aparecen JUNTAS o de forma repetida en varias fotos, con miradas, contacto físico o conexión emocional.

Devuelve un JSON con:
- couple_hashes: array de fingerprint_hash de las fotos donde aparece claramente la pareja protagonista (juntos o individualmente identificables como los novios).
- confidence (0-100): tu confianza en la identificación.

Si no puedes identificar a la pareja con claridad, devuelve couple_hashes vacío y confidence bajo.`;

  const file_urls = photos.map((p) => `data:image/jpeg;base64,${p.preview_base64}`);
  const trace = {};
  const res = await invokeVision(base44, {
    task: "seleccion",
    prompt,
    file_urls,
    response_json_schema: {
      type: "object",
      properties: {
        couple_hashes: { type: "array", items: { type: "string" } },
        confidence: { type: "number" },
      },
    },
    _trace: trace,
  });
  const couple_hashes = Array.isArray(res?.couple_hashes) ? res.couple_hashes.filter(Boolean) : [];
  const confidence = Number(res?.confidence) || 0;
  return Response.json({ couple_hashes, confidence, trace });
}

// plan-film: el AI Film Director. Recibe la base de datos de fotos (sin imágenes, solo
// metadatos + scores), el análisis de música y el estilo. Genera el Film Plan completo:
// escenas, timeline (orden + duración + movimiento + transición + intensidad), clímax.
// No envía imágenes: es una tarea de TEXTO (planificación narrativa). Usa InvokeLLM.
// → { film_plan: { scenes, timeline, total_duration, climax_at } }
async function doPlanFilm(base44, body) {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  const music = body.music || null;
  const style = body.style || "auto";
  const settings = body.settings || {};
  const coupleHashes = Array.isArray(body.couple_hashes) ? body.couple_hashes : [];

  if (!photos.length) return Response.json({ error: "No hay fotos para planificar" }, { status: 400 });

  // Construye un resumen compacto de la base de datos de fotos para el LLM.
  const photoDb = photos.map((p) => ({
    h: p.fingerprint_hash,
    s: p.scene,
    e: p.emotion_score,
    q: p.quality_score,
    p: p.people_score,
    c: p.has_couple || coupleHashes.includes(p.fingerprint_hash) ? 1 : 0,
    d: p.description,
  }));

  const musicInfo = music ? {
    duration: music.duration_sec,
    bpm: music.bpm,
    sections: music.sections,
    climax_at: music.climax_at,
  } : null;

  const targetDuration = settings.target_duration || (music?.duration_sec || 180);

  const prompt = `Eres el AI FILM DIRECTOR de EditFlow. Tu misión es crear un Film Plan para un vídeo de boda cinematográfico y emocional. El usuario NO editará la timeline: tú decides todo.

DATOS DE ENTRADA:
- Base de datos de fotos (h=hash, s=escena, e=emoción 0-100, q=calidad 0-100, p=personas 0-100, c=pareja 1/0, d=descripción):
${JSON.stringify(photoDb)}

- Música: ${JSON.stringify(musicInfo)}
- Estilo: ${style}
- Duración objetivo: ${targetDuration}s
- Fotos de pareja identificadas: ${coupleHashes.length}

REGLAS:
1. Selecciona las mejores fotos para el vídeo (no uses todas). Prioriza emoción > pareja > calidad. Evita repetición (misma escena/instante).
2. Construye una ESTRUCTURA NARRATIVA: introducción → preparativos → ceremonia → pareja → celebración → fiesta → final. Usa solo las escenas que existan.
3. ASIGNA duración a cada foto según la intensidad de la música: partes suaves = fotos más largas (4-6s), partes dinámicas = fotos más cortas (1.5-3s).
4. El CLÍMAX (momento de mayor intensidad de la canción) debe tener las fotos más potentes de la pareja (beso, abrazo, mirada).
5. ASIGNA un MOVIMIENTO cinematográfico a cada foto: "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down", "dolly_in", "ken_burns", "parallax". El movimiento debe respetar el contenido (persona mirando a la derecha → pan compatible; pareja → movimiento suave hacia ellos; fiesta → más dinámico; emoción → lento y elegante). Usa "parallax" en fotos con profundidad clara (primer plano + fondo, paisajes, retratos con fondo bokeh) para un efecto 2.5D. No uses parallax en más del 15% de las fotos.
6. ASIGNA una TRANSICIÓN a cada foto (la transición ENTRANTE desde la anterior): "cut", "cross_dissolve", "dip_to_black", "soft_blur", "zoom_transition", "fade". NO uses una transición distinta por obligación: usa "cut" o "cross_dissolve" la mayoría; reservar transiciones especiales para cambios de escena o clímax.
7. ASIGNA una intensidad (0-100) a cada foto según la música en ese momento.

Devuelve un JSON:
{
  "scenes": [{ "name": "string", "photo_hashes": [string], "start_sec": number, "intensity": number }],
  "timeline": [{ "hash": "string", "duration": number, "motion": "string", "transition": "string", "intensity": number, "scene": "string" }],
  "total_duration": number,
  "climax_at": number
}

El timeline debe sumar aproximadamente la duración objetivo. Ordena las fotos cronológicamente por escena narrativa.`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              photo_hashes: { type: "array", items: { type: "string" } },
              start_sec: { type: "number" },
              intensity: { type: "number" },
            },
          },
        },
        timeline: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hash: { type: "string" },
              duration: { type: "number" },
              motion: { type: "string" },
              transition: { type: "string" },
              intensity: { type: "number" },
              scene: { type: "string" },
            },
          },
        },
        total_duration: { type: "number" },
        climax_at: { type: "number" },
      },
    },
  });

  const film_plan = {
    scenes: Array.isArray(res?.scenes) ? res.scenes : [],
    timeline: Array.isArray(res?.timeline) ? res.timeline : [],
    total_duration: Number(res?.total_duration) || targetDuration,
    climax_at: Number(res?.climax_at) || 0,
  };
  return Response.json({ film_plan });
}