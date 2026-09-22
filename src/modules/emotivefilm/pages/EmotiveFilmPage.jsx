// 🎬 Emotive Film IA — página principal. Interfaz sencilla: el usuario NO edita la
// timeline. La IA analiza, selecciona, planifica y monta. El usuario solo revisa,
// añade/quita/fija/excluye fotos, añade la canción y genera.
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Sparkles, Film, Wand2, RefreshCw, AlertCircle, ArrowLeft, Eye } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getFilm, upsertFilm } from "../lib/filmStore";
import { runAnalysis, runPlanFilm } from "../lib/filmDirector";
import { gatherProjectPhotos } from "../lib/photoGatherer";
import { buildTimeline, validateTimeline, ensureClimaxCouple } from "../lib/timelineBuilder";
import { decodeAudioFile } from "../lib/musicAnalyzer";
import { loadBatchPreviews } from "../lib/photoGatherer";
import { regeneratePartial } from "../lib/smartRegen";
import { generateHeroVideos } from "../lib/heroVideoPipeline";
import SelectionReview from "../components/SelectionReview";
import MusicPanel from "../components/MusicPanel";
import StyleSelector from "../components/StyleSelector";
import AdvancedSettings from "../components/AdvancedSettings";
import PreviewPlayer from "../components/PreviewPlayer";
import ExportPanel from "../components/ExportPanel";
import { useToast } from "@/components/ui/use-toast";

export default function EmotiveFilmPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const { toast } = useToast();

  const [film, setFilm] = useState(null);
  const [project, setProject] = useState(null);
  const [allPhotos, setAllPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState(null); // "gather" | "analyze" | "select" | "planning"
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [analyzing, setAnalyzing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [generatingHeroes, setGeneratingHeroes] = useState(false);
  const [heroProgress, setHeroProgress] = useState({});

  // Estado editable de la selección (se sincroniza con `film.selection`).
  const [selection, setSelection] = useState([]);
  const [style, setStyle] = useState("auto");
  const [settings, setSettings] = useState({});
  const [music, setMusic] = useState(null);
  const [exportConfig, setExportConfig] = useState({ aspect_ratio: "16:9", resolution: "1080p", format: "mp4" });

  // Carga inicial: proyecto + film existente.
  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const [p, f] = await Promise.all([
          base44.entities.Project.get(projectId),
          getFilm(projectId),
        ]);
        if (!alive) return;
        setProject(p);
        setFilm(f);
        if (f) {
          setSelection(f.selection || []);
          setStyle(f.style || "auto");
          setSettings(f.advanced_settings || {});
          setMusic(f.music || null);
          setExportConfig(f.export_config || exportConfig);
        }
        const photos = await gatherProjectPhotos(projectId);
        if (!alive) return;
        setAllPhotos(photos);
      } catch (e) {
        toast({ title: "No se pudo abrir el proyecto", description: e?.message, variant: "destructive" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // El audioBuffer se recibe del MusicPanel al añadir la canción (no se persiste:
  // es un AudioBuffer en memoria que vive solo en esta sesión). Al reabrir el
  // proyecto, el análisis musical se conserva pero el audio para la preview se
  // recupera re-añadiendo la canción.

  // Persistencia: guarda cambios de selección/estilo/ajustes/música.
  const persist = useCallback(async (patch) => {
    if (!projectId) return;
    const updated = await upsertFilm(projectId, patch);
    setFilm((f) => ({ ...f, ...patch, ...updated }));
  }, [projectId]);

  // === FLUJO PRINCIPAL: Analizar → Seleccionar ===
  const handleAnalyze = async () => {
    if (!projectId) return;
    setAnalyzing(true);
    setStage("gather");
    setProgress({ done: 0, total: 0 });
    try {
      const signal = { aborted: false };
      const result = await runAnalysis({
        projectId,
        style,
        settings,
        onProgress: (st, done, total) => {
          setStage(st);
          setProgress({ done, total });
        },
        signal,
      });
      setSelection(result.selection);
      setFilm(result.film);
      if (result.partialWarning) {
        toast({ title: "Análisis completado con advertencias", description: result.partialWarning, variant: "destructive" });
      } else {
        toast({ title: "Análisis completado", description: `${result.selection.length} fotos seleccionadas por la IA` });
      }
    } catch (e) {
      toast({ title: "Error en el análisis", description: e?.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
      setStage(null);
    }
  };

  // === FLUJO: Generar Film Plan ===
  const handleCreateVideo = async () => {
    if (!selection.length) {
      toast({ title: "Sin fotos", description: "Analiza el proyecto primero.", variant: "destructive" });
      return;
    }
    if (!music) {
      toast({ title: "Falta la canción", description: "Añade una canción antes de crear el vídeo.", variant: "destructive" });
      return;
    }
    setPlanning(true);
    try {
      const activeSelection = selection.filter((s) => !s.exclude);
      const filmPlan = await runPlanFilm({
        projectId,
        selection: activeSelection,
        music,
        style,
        settings,
        coupleHashes: film?.couple_ids || [],
        onProgress: (st, done, total) => setStage(st),
      });
      setStage(null);
      // Construye la timeline y asegura que el clímax tenga fotos de pareja.
      let { clips, totalDuration } = buildTimeline(filmPlan, music, settings, film?.hero_videos || {});
      clips = ensureClimaxCouple(clips, filmPlan.climax_at, film?.couple_ids || []);
      const previewMap = await loadBatchPreviews(clips.map((c) => c.hash));
      const { ok, errors } = validateTimeline(clips, previewMap);
      setValidationErrors(errors);
      if (!ok) {
        toast({ title: "Timeline con problemas", description: errors[0], variant: "destructive" });
      } else {
        toast({ title: "Film Plan generado", description: `${clips.length} clips · ${Math.round(totalDuration)}s` });
        setShowPreview(true);
      }
      // Refresca el film desde la BD.
      const f = await getFilm(projectId);
      setFilm(f);
    } catch (e) {
      toast({ title: "Error al generar el plan", description: e?.message, variant: "destructive" });
    } finally {
      setPlanning(false);
      setStage(null);
    }
  };

  // === Regenerar: intenta primero regeneración parcial (sin LLM) ===
  const handleRegenerate = async () => {
    if (!film?.film_plan) { return handleCreateVideo(); }
    setPlanning(true);
    try {
      // Calcula qué fotos han sido excluidas desde la última generación.
      const excludedHashes = selection.filter((s) => s.exclude).map((s) => s.fingerprint_hash);
      const removedHashes = film.film_plan.timeline
        ?.map((t) => t.hash)
        .filter((h) => !selection.find((s) => s.fingerprint_hash === h && !s.exclude)) || [];

      const allRemoved = [...new Set([...excludedHashes, ...removedHashes])];

      // Intenta regeneración parcial (sin LLM) si el cambio es pequeño.
      const partialPlan = regeneratePartial(film.film_plan, allRemoved);

      if (partialPlan) {
        // Regeneración parcial: reconstruye la timeline y asegura clímax sin LLM.
        let { clips } = buildTimeline(partialPlan, music, settings, film?.hero_videos || {});
        clips = ensureClimaxCouple(clips, partialPlan.climax_at, film?.couple_ids || []);
        const hashToEntry = new Map((partialPlan.timeline || []).map((t) => [t.hash, t]));
        partialPlan.timeline = clips.map((c) => ({
          ...(hashToEntry.get(c.hash) || {}),
          hash: c.hash, scene: c.scene, duration: c.duration,
          motion: c.motion, transition: c.transition, intensity: c.intensity,
          subject_position: c.subjectPosition || "center",
        }));
        await persist({ film_plan: partialPlan, status: "planned" });
        setFilm((f) => ({ ...f, film_plan: partialPlan }));
        toast({ title: "Vídeo actualizado", description: "Timeline ajustada sin reconstruir el plan completo" });
      } else {
        // Regeneración completa: el cambio es grande, llama al LLM.
        const activeSelection = selection.filter((s) => !s.exclude);
        const filmPlan = await runPlanFilm({
          projectId,
          selection: activeSelection,
          music,
          style,
          settings,
          coupleHashes: film?.couple_ids || [],
          onProgress: () => {},
        });
        const f = await getFilm(projectId);
        setFilm(f);
        toast({ title: "Vídeo regenerado", description: "Plan reconstruido (cambio estructural detectado)" });
      }
    } catch (e) {
      toast({ title: "Error al regenerar", description: e?.message, variant: "destructive" });
    } finally {
      setPlanning(false);
    }
  };

  // === Optimizar selección ===
  const handleOptimize = async () => {
    // Re-ejecuta solo la selección (sin re-analizar: usa el caché).
    if (!projectId) return;
    setAnalyzing(true);
    try {
      const result = await runAnalysis({
        projectId,
        style,
        settings,
        onProgress: () => {},
      });
      // Conserva los pins y exclusiones del usuario.
      const pinSet = new Set(selection.filter((s) => s.pin).map((s) => s.fingerprint_hash));
      const exclSet = new Set(selection.filter((s) => s.exclude).map((s) => s.fingerprint_hash));
      const optimized = result.selection.map((s) => ({
        ...s,
        pin: pinSet.has(s.fingerprint_hash),
        exclude: exclSet.has(s.fingerprint_hash),
      }));
      // Añade las fijadas que ya no están en la selección optimizada.
      const optHashes = new Set(optimized.map((s) => s.fingerprint_hash));
      for (const s of selection) {
        if (s.pin && !optHashes.has(s.fingerprint_hash)) optimized.push(s);
      }
      setSelection(optimized);
      await persist({ selection: optimized });
      toast({ title: "Selección optimizada", description: `${optimized.length} fotos` });
    } catch (e) {
      toast({ title: "Error al optimizar", description: e?.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  // === FLUJO: Generar HERO VIDEOS IA (Kling 3.0 Pro Image-to-Video) ===
  const handleGenerateHeroVideos = async () => {
    if (!film?.film_plan) return;
    setGeneratingHeroes(true);
    setHeroProgress({});
    try {
      const signal = { aborted: false };
      const updated = await generateHeroVideos({
        projectId,
        filmPlan: film.film_plan,
        heroVideos: film.hero_videos || {},
        settings,
        exportConfig,
        onProgress: (hash, status, info) => {
          setHeroProgress((p) => ({ ...p, [hash]: { status, info } }));
        },
        signal,
      });
      const f = await getFilm(projectId);
      setFilm(f);
      const completed = Object.values(updated).filter((v) => v.status === "completed").length;
      const fallback = Object.values(updated).filter((v) => v.status === "fallback").length;
      toast({
        title: "HERO VIDEOS generados",
        description: `${completed} vídeos IA completados · ${fallback} fallback al motor 2D`,
      });
    } catch (e) {
      toast({ title: "Error generando HERO VIDEOS", description: e?.message, variant: "destructive" });
    } finally {
      setGeneratingHeroes(false);
    }
  };

  // === Controles de selección ===
  const togglePin = async (hash) => {
    const next = selection.map((s) => s.fingerprint_hash === hash ? { ...s, pin: !s.pin, exclude: false } : s);
    setSelection(next);
    await persist({ selection: next });
  };
  const toggleExclude = async (hash) => {
    const next = selection.map((s) => s.fingerprint_hash === hash ? { ...s, exclude: !s.exclude, pin: false } : s);
    setSelection(next);
    await persist({ selection: next });
  };
  const removePhoto = async (hash) => {
    const next = selection.filter((s) => s.fingerprint_hash !== hash);
    setSelection(next);
    await persist({ selection: next });
  };
  const addPhoto = async (photo) => {
    if (selection.find((s) => s.fingerprint_hash === photo.fingerprint_hash)) return;
    const next = [...selection, {
      fingerprint_hash: photo.fingerprint_hash,
      filename: photo.filename,
      folder_id: photo.folder_id,
      scene: "otros",
      emotion_score: 0, quality_score: 0, people_score: 0, narrative_score: 0,
      has_couple: false, description: "", pin: true, exclude: false,
    }];
    setSelection(next);
    await persist({ selection: next });
  };

  const handleStyleChange = async (s) => { setStyle(s); await persist({ style: s }); };
  const handleSettingsChange = async (s) => { setSettings(s); await persist({ advanced_settings: s }); };
  const handleMusicChange = async (m) => { setMusic(m); await persist({ music: m }); };
  const handleExportConfigChange = async (c) => { setExportConfig(c); await persist({ export_config: c }); };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">🎬 Emotive Film IA</h1>
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Film className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Abre un proyecto desde <button onClick={() => navigate("/proyectos")} className="text-accent underline">Proyectos</button> para usar Emotive Film IA.
          </p>
        </div>
      </div>
    );
  }

  const activeCount = selection.filter((s) => !s.exclude).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">🎬 Emotive Film IA</h1>
          {project && <p className="text-sm text-muted-foreground">{project.title}</p>}
        </div>
        <button
          onClick={() => navigate("/proyectos")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Proyectos
        </button>
      </div>

      {/* Estado de análisis */}
      {analyzing && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {stage === "gather" ? "Recopilando fotos del proyecto…" :
               stage === "analyze" ? `Analizando con IA… ${progress.done}/${progress.total}` :
               stage === "select" ? "Construyendo selección…" :
               stage === "planning" ? "Generando Film Plan…" : "Procesando…"}
            </span>
          </div>
          {stage === "analyze" && progress.total > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Interfaz principal: simple */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Columna izquierda: selección + música + estilo */}
        <div className="space-y-4 lg:col-span-2">
          {/* Selección IA */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Fotos seleccionadas por IA</h3>
                <p className="text-xs text-muted-foreground">{activeCount} fotos activas · {selection.length} total</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowReview((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  <Eye className="h-3.5 w-3.5" /> {showReview ? "Ocultar" : "Ver selección"}
                </button>
                <button
                  onClick={handleOptimize}
                  disabled={analyzing || !selection.length}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Optimizar
                </button>
              </div>
            </div>
            {!selection.length && !analyzing && (
              <p className="mt-3 text-sm text-muted-foreground">
                Pulsa <strong>Analizar proyecto</strong> para que la IA seleccione las fotos más emocionales.
              </p>
            )}
          </div>

          {showReview && (
            <SelectionReview
              selection={selection}
              allPhotos={allPhotos}
              onTogglePin={togglePin}
              onToggleExclude={toggleExclude}
              onRemove={removePhoto}
              onAdd={addPhoto}
            />
          )}

          {/* Música */}
          <MusicPanel music={music} onChange={handleMusicChange} onAudioBuffer={setAudioBuffer} />

          {/* Estilo */}
          <StyleSelector style={style} onChange={handleStyleChange} />
        </div>

        {/* Columna derecha: acciones + ajustes */}
        <div className="space-y-4">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !allPhotos.length}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-40"
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {selection.length ? "Re-analizar proyecto" : "Analizar proyecto"}
          </button>

          <button
            onClick={handleCreateVideo}
            disabled={planning || !selection.length || !music}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            ✨ Crear vídeo
          </button>

          {film?.film_plan && (
            <button
              onClick={handleRegenerate}
              disabled={planning}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-40"
            >
              <RefreshCw className="h-4 w-4" /> Regenerar
            </button>
          )}

          {film?.film_plan && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <h4 className="text-xs font-semibold">HERO VIDEOS IA</h4>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Kling 3.0 Pro genera vídeos IA reales para los momentos más potentes. El resto usa el motor cinematográfico 2D.
              </p>
              <button
                onClick={handleGenerateHeroVideos}
                disabled={generatingHeroes}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground disabled:opacity-40"
              >
                {generatingHeroes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {generatingHeroes ? "Generando…" : "Generar HERO VIDEOS IA"}
              </button>
              {Object.keys(film?.hero_videos || {}).length > 0 && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {Object.values(film.hero_videos).filter((v) => v.status === "completed").length} completados ·{" "}
                  {Object.values(film.hero_videos).filter((v) => v.status === "fallback").length} fallback
                </div>
              )}
              {generatingHeroes && Object.keys(heroProgress).length > 0 && (
                <div className="mt-2 space-y-1">
                  {Object.entries(heroProgress).slice(-3).map(([hash, p]) => (
                    <div key={hash} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      <span className="truncate">{p.status}…</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <AdvancedSettings settings={settings} onChange={handleSettingsChange} />

          {validationErrors.length > 0 && (
            <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertCircle className="h-3.5 w-3.5" /> Problemas detectados:
              </div>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {validationErrors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Preview + Exportación (solo si hay Film Plan) */}
      {film?.film_plan && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PreviewPlayer
            filmPlan={film.film_plan}
            music={music}
            settings={settings}
            exportConfig={exportConfig}
            audioBuffer={audioBuffer}
            heroVideos={film?.hero_videos || {}}
          />
          <ExportPanel
            filmPlan={film.film_plan}
            music={music}
            settings={settings}
            exportConfig={exportConfig}
            onChange={handleExportConfigChange}
            audioBuffer={audioBuffer}
            heroVideos={film?.hero_videos || {}}
          />
        </div>
      )}
    </div>
  );
}