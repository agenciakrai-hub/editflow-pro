// Reproductor de preview: canvas con la timeline renderizada + audio sincronizado.
// Controles: play/pausa, seek, tiempo. Usa FilmRenderer.
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2 } from "lucide-react";
import { FilmRenderer } from "../lib/videoRenderer";
import { buildTimeline, validateTimeline } from "../lib/timelineBuilder";
import { loadBatchPreviews } from "../lib/photoGatherer";

export default function PreviewPlayer({ filmPlan, music, settings, exportConfig, audioBuffer, heroVideos }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { clips, totalDuration } = buildTimeline(filmPlan, music, settings, heroVideos);

  useEffect(() => {
    if (!canvasRef.current || !clips.length) return;
    const r = new FilmRenderer(canvasRef.current, exportConfig?.aspect_ratio || "16:9");
    r.setResolution(exportConfig?.aspect_ratio || "16:9", "1080p");
    r.setTimeline(clips, totalDuration, "#000000");
    r.setHeroVideos(heroVideos);
    if (audioBuffer) r.setAudio(audioBuffer);
    r.onTime = (t, tot) => { setTime(t); setTotal(tot); };
    r.onEnd = () => setPlaying(false);
    rendererRef.current = r;
    // Precarga todas las imágenes de la timeline y dibuja el primer frame.
    setLoading(true);
    (async () => {
      try {
        const hashes = clips.map((c) => c.hash).filter(Boolean);
        await loadBatchPreviews(hashes);
        for (const c of clips) {
          if (c.videoUrl) await r._getVideo(c.hash);
          else await r._getImage(c.hash);
        }
        r._drawFrame(0);
        setTotal(totalDuration);
      } catch (e) {
        setError(e?.message || "Error al cargar las previews");
      } finally {
        setLoading(false);
      }
    })();
    return () => { r.destroy(); rendererRef.current = null; };
  }, [filmPlan, exportConfig?.aspect_ratio, audioBuffer, heroVideos]);

  const togglePlay = async () => {
    const r = rendererRef.current;
    if (!r) return;
    if (playing) {
      r.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      await r.play(time >= total ? 0 : time);
    }
  };

  const seek = (t) => {
    const r = rendererRef.current;
    if (!r) return;
    r.seek(t);
    setTime(t);
  };

  if (!filmPlan?.timeline?.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Genera el Film Plan para ver la preview.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Previsualización</h3>
      <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: exportConfig?.aspect_ratio === "9:16" ? "9/16" : exportConfig?.aspect_ratio === "1:1" ? "1/1" : "16/9" }}>
        <canvas ref={canvasRef} className="h-full w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={loading}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.1}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {fmt(time)} / {fmt(total)}
        </span>
      </div>
    </div>
  );
}

function fmt(sec) {
  if (!sec && sec !== 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}