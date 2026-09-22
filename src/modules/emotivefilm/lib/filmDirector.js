// AI Film Director — orquesta el flujo completo:
//   gather → analyze (VLM por lotes) → identify couple → select → plan (LLM)
// Reutiliza el backend function `emotive-film` para las llamadas IA y el caché de
// análisis (analysis_cache en la entidad) para no re-analizar fotos ya procesadas.
import { base44 } from "@/api/base44Client";
import { gatherProjectPhotos, loadBatchPreviews } from "./photoGatherer";
import { getFilm, upsertFilm, mergeAnalysisCache } from "./filmStore";

const ANALYZE_BATCH = 8; // fotos por llamada VLM (limite de imágenes por request)
const ANALYZE_CONCURRENCY = 3; // lotes en paralelo

// Ejecuta el análisis completo del proyecto. Devuelve { photos, coupleHashes, film }.
// onProgress(stage, done, total) notifica el avance.
export async function runAnalysis({ projectId, style, settings, onProgress, signal }) {
  let film = await getFilm(projectId);
  if (!film) {
    film = await upsertFilm(projectId, { status: "analyzing", style, advanced_settings: settings || {} });
  } else {
    film = await upsertFilm(projectId, { status: "analyzing", style, advanced_settings: settings || {} });
  }

  // 1. Recopilar todas las fotos del proyecto (todas las carpetas).
  const allPhotos = await gatherProjectPhotos(projectId);
  if (!allPhotos.length) throw new Error("El proyecto no tiene fotos. Importa una carpeta primero.");
  onProgress?.("gather", allPhotos.length, allPhotos.length);

  // 2. Cargar previews por lotes y analizar con VLM. Reutiliza el caché de análisis.
  const cache = film.analysis_cache || {};
  const toAnalyze = allPhotos.filter((p) => !cache[p.fingerprint_hash]);
  const analyzed = { ...cache };

  // Carga los hashes a analizar en lotes, extrae el base64 y envía al VLM.
  const batches = [];
  for (let i = 0; i < toAnalyze.length; i += ANALYZE_BATCH) {
    batches.push(toAnalyze.slice(i, i + ANALYZE_BATCH));
  }

  let done = 0;
  const total = toAnalyze.length;
  const batchErrors = []; // [{ count, error }] — lotes donde TODOS los proveedores fallaron
  await runParallel(batches, ANALYZE_CONCURRENCY, async (batch) => {
    if (signal?.aborted) return;
    const hashes = batch.map((p) => p.fingerprint_hash);
    const previewMap = await loadBatchPreviews(hashes);
    const photosWithPreview = batch
      .map((p) => {
        const pv = previewMap.get(p.fingerprint_hash);
        if (!pv?.dataUrl) return null;
        const base64 = pv.dataUrl.split(",")[1] || "";
        return { fingerprint_hash: p.fingerprint_hash, preview_base64: base64 };
      })
      .filter(Boolean);
    if (!photosWithPreview.length) {
      done += batch.length;
      onProgress?.("analyze", done, total);
      return;
    }
    try {
      const res = await base44.functions.invoke("emotive-film", {
        action: "analyze-batch",
        photos: photosWithPreview,
      });
      const results = res?.data?.results || [];
      if (!results.length && photosWithPreview.length) {
        // El backend no devolvió resultados: todos los proveedores fallaron.
        batchErrors.push({ count: photosWithPreview.length, error: res?.data?.error || "Proveedores IA no disponibles" });
      }
      for (const r of results) {
        if (r.fingerprint_hash) {
          analyzed[r.fingerprint_hash] = {
            fingerprint_hash: r.fingerprint_hash,
            emotion_score: r.emotion_score,
            quality_score: r.quality_score,
            people_score: r.people_score,
            has_couple: r.has_couple,
            scene: r.scene,
            description: r.description,
            at: Date.now(),
          };
        }
      }
    } catch (e) {
      console.warn("analyze-batch error", e?.message || e);
      batchErrors.push({ count: photosWithPreview.length, error: e?.message || "Error de red" });
    }
    done += batch.length;
    onProgress?.("analyze", done, total);
  });

  // Si TODOS los lotes con fotos fallaron, lanza un error claro al usuario.
  const totalFailed = batchErrors.reduce((s, e) => s + e.count, 0);
  const totalAnalyzed = Object.keys(analyzed).filter((k) => !cache[k]).length;
  if (totalFailed > 0 && totalAnalyzed === 0) {
    const lastError = batchErrors[batchErrors.length - 1]?.error || "desconocido";
    throw new Error(`Todos los proveedores IA fallaron (${totalFailed} fotos sin analizar). Último error: ${lastError}. Revisa los proveedores en Proveedores IA.`);
  }

  // Persiste el caché de análisis.
  film = await mergeAnalysisCache(film, Object.values(analyzed).filter((v) => !cache[v.fingerprint_hash]));

  // 3. Identificar la pareja protagonista desde una muestra de fotos con has_couple.
  let coupleHashes = film.couple_ids || [];
  if (!coupleHashes.length) {
    const coupleCandidates = Object.values(analyzed)
      .filter((a) => a.has_couple)
      .slice(0, 12);
    if (coupleCandidates.length >= 2) {
      try {
        const sampleHashes = coupleCandidates.map((c) => c.fingerprint_hash);
        const previewMap = await loadBatchPreviews(sampleHashes);
        const photosForVLM = sampleHashes
          .map((h) => {
            const pv = previewMap.get(h);
            if (!pv?.dataUrl) return null;
            return { fingerprint_hash: h, preview_base64: pv.dataUrl.split(",")[1] || "" };
          })
          .filter(Boolean);
        const res = await base44.functions.invoke("emotive-film", {
          action: "identify-couple",
          photos: photosForVLM,
        });
        coupleHashes = res?.data?.couple_hashes || [];
        if (coupleHashes.length) {
          await upsertFilm(projectId, { couple_ids: coupleHashes });
        }
      } catch (e) {
        console.warn("identify-couple error", e?.message || e);
      }
    }
  }

  // 4. Selección automática: combina scores + prioridad de pareja + evita repetición.
  const selection = buildSelection(allPhotos, analyzed, coupleHashes, settings);
  onProgress?.("select", selection.length, selection.length);

  // 5. Guarda la selección en la entidad.
  film = await upsertFilm(projectId, {
    status: "selected",
    selection,
    couple_ids: coupleHashes,
  });

  // Advertencia parcial: algunos lotes fallaron pero el análisis continuó.
  const partialWarning = batchErrors.length > 0 && totalAnalyzed > 0
    ? `${batchErrors.length} lote(s) fallaron (${totalFailed} fotos sin analizar). ${totalAnalyzed} fotos analizadas correctamente.`
    : null;

  return { photos: allPhotos, analyzed, coupleHashes, selection, film, partialWarning };
}

// Construye la selección automática. Combina scores, prioriza la pareja, evita
// repetición de escenas, ELIMINA FOTOS DUPLICADAS (pHash hamming) y aplica los pesos.
function buildSelection(allPhotos, analyzed, coupleHashes, settings) {
  const s = settings || {};
  const emotionW = s.emotion_intensity == null || s.emotion_intensity === "auto" ? 1 : Number(s.emotion_intensity) / 50;
  const coupleW = s.couple_priority == null || s.couple_priority === "auto" ? 1.5 : 1 + Number(s.couple_priority) / 100;
  const maxPhotos = s.max_photos == null || s.max_photos === "auto" ? 120 : Number(s.max_photos);

  const scored = allPhotos.map((p) => {
    const a = analyzed[p.fingerprint_hash];
    if (!a) return null;
    const isCouple = coupleHashes.includes(p.fingerprint_hash) || a.has_couple;
    const emotion = (a.emotion_score || 0) * emotionW;
    const quality = a.quality_score || 0;
    const people = a.people_score || 0;
    const coupleBonus = isCouple ? 30 * coupleW : 0;
    const narrative = emotion * 0.4 + people * 0.3 + quality * 0.2 + coupleBonus;
    return {
      fingerprint_hash: p.fingerprint_hash,
      filename: p.filename,
      folder_id: p.folder_id,
      scene: a.scene || "otros",
      emotion_score: a.emotion_score || 0,
      quality_score: quality,
      people_score: people,
      has_couple: isCouple,
      narrative_score: Math.round(narrative),
      description: a.description || "",
      pin: false,
      exclude: false,
    };
  }).filter(Boolean);

  // Ordena por score narrativo.
  scored.sort((a, b) => b.narrative_score - a.narrative_score);

  // ELIMINACIÓN DE DUPLICADOS: dos fotos con pHash hamming distance < 6 son
  // visualmente casi idénticas (misma toma, ráfaga). Se keep la de mayor score
  // y se descarta la otra. El fingerprint_hash ES el pHash en hexadecimal.
  const deduped = [];
  const acceptedHashes = [];
  for (const p of scored) {
    let isDup = false;
    for (const ah of acceptedHashes) {
      if (phashHamming(p.fingerprint_hash, ah) < 6) { isDup = true; break; }
    }
    if (isDup) continue;
    deduped.push(p);
    acceptedHashes.push(p.fingerprint_hash);
  }

  // Evita repetición: máximo N fotos por escena (proporcional al total).
  const maxPerScene = Math.max(3, Math.floor(maxPhotos / 8));
  const byScene = {};
  const selected = [];
  for (const p of deduped) {
    if (selected.length >= maxPhotos) break;
    const sc = p.scene || "otros";
    if ((byScene[sc] || 0) >= maxPerScene && sc !== "pareja" && sc !== "beso") continue;
    byScene[sc] = (byScene[sc] || 0) + 1;
    selected.push(p);
  }

  // Reordena por tiempo de captura (orden cronológico natural).
  const hashToPhoto = new Map(allPhotos.map((p) => [p.fingerprint_hash, p]));
  selected.sort((a, b) => {
    const ta = hashToPhoto.get(a.fingerprint_hash)?.capture_time || 0;
    const tb = hashToPhoto.get(b.fingerprint_hash)?.capture_time || 0;
    return ta - tb;
  });

  return selected;
}

// Distancia de Hamming entre dos pHash hexadecimales. Devuelve el número de bits
// diferentes. <6 = casi idénticas; <12 = muy similares; >16 = diferentes.
function phashHamming(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 64;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const xa = parseInt(hashA[i], 16);
    const xb = parseInt(hashB[i], 16);
    let diff = xa ^ xb;
    while (diff) { dist += diff & 1; diff >>= 1; }
  }
  return dist;
}

// Genera el Film Plan llamando al backend (LLM). Recibe la selección + música + estilo.
// Tras recibir el plan, aplica ensureClimaxCouple para garantizar que el clímax
// tenga fotos de pareja antes de persistir.
export async function runPlanFilm({ projectId, selection, music, style, settings, coupleHashes, onProgress, signal }) {
  onProgress?.("planning", 0, 1);
  const res = await base44.functions.invoke("emotive-film", {
    action: "plan-film",
    photos: selection.map((s) => ({
      fingerprint_hash: s.fingerprint_hash,
      scene: s.scene,
      emotion_score: s.emotion_score,
      quality_score: s.quality_score,
      people_score: s.people_score,
      has_couple: s.has_couple,
      description: s.description,
    })),
    music,
    style,
    settings,
    couple_hashes: coupleHashes || [],
  });
  const film_plan = res?.data?.film_plan;
  if (!film_plan) throw new Error("El AI Film Director no pudo generar el plan.");

  // Construye la timeline normalizada y asegura que el clímax tenga fotos de pareja.
  // Modifica el film_plan.timeline in-place para que el plan persistido sea correcto.
  const { buildTimeline, ensureClimaxCouple } = await import("./timelineBuilder");
  const { clips } = buildTimeline(film_plan, music, settings);
  const fixedClips = ensureClimaxCouple(clips, film_plan.climax_at, coupleHashes || []);
  // Si ensureClimaxCouple cambió algo, actualiza el timeline del film_plan.
  if (fixedClips !== clips) {
    const hashToEntry = new Map((film_plan.timeline || []).map((t) => [t.hash, t]));
    film_plan.timeline = fixedClips.map((c) => ({
      ...(hashToEntry.get(c.hash) || {}),
      hash: c.hash,
      scene: c.scene,
      duration: c.duration,
      motion: c.motion,
      transition: c.transition,
      intensity: c.intensity,
    }));
  }

  onProgress?.("planning", 1, 1);
  await upsertFilm(projectId, { status: "planned", film_plan });
  return film_plan;
}

// Utilidad: ejecuta tareas en paralelo con límite de concurrencia.
function runParallel(items, concurrency, fn) {
  return new Promise((resolve, reject) => {
    let idx = 0, active = 0, done = 0, failed = false;
    const next = () => {
      if (failed) return;
      if (done === items.length) return resolve();
      while (active < concurrency && idx < items.length) {
        const item = items[idx++];
        active++;
        Promise.resolve(fn(item, idx - 1)).then(() => {
          active--; done++;
          next();
        }).catch((e) => {
          if (!failed) { failed = true; reject(e); }
        });
      }
    };
    if (!items.length) resolve();
    else next();
  });
}