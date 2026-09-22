// Panel de exportación: configuración (aspecto, resolución, formato) + render.
// Usa FilmRenderer.export() (canvas.captureStream + MediaRecorder).
import { useState, useRef, useEffect } from "react";
import { Download, Loader2, Film, AlertCircle, CheckCircle2 } from "lucide-react";
import { FilmRenderer } from "../lib/videoRenderer";
import { buildTimeline, validateTimeline } from "../lib/timelineBuilder";
import { loadBatchPreviews } from "../lib/photoGatherer";
import { isWebCodecsAvailable, detectBestFormat, exportWithWebCodecs } from "../lib/professionalRenderer";

export default function ExportPanel({ filmPlan, music, settings, exportConfig, onChange, audioBuffer }) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadFormat, setDownloadFormat] = useState(null);
  const [error, setError] = useState(null);
  const [availableFormat, setAvailableFormat] = useState(null); // "mp4" | "webm" | null
  const canvasRef = useRef(null);

  const { clips, totalDuration } = buildTimeline(filmPlan, music, settings);

  // Detecta el formato disponible al montar o cambiar resolución/aspecto.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isWebCodecsAvailable()) { setAvailableFormat("webm_mediaRecorder"); return; }
      const ar = exportConfig.aspect_ratio === "9:16" ? [9, 16] : exportConfig.aspect_ratio === "1:1" ? [1, 1] : [16, 9];
      const baseH = exportConfig.resolution === "4k" ? 2160 : 1080;
      const h = baseH;
      const w = Math.round(h * (ar[0] / ar[1]));
      const info = await detectBestFormat(w, h);
      if (!alive) return;
      setAvailableFormat(info.format || "webm_mediaRecorder");
    })();
    return () => { alive = false; };
  }, [exportConfig.aspect_ratio, exportConfig.resolution]);

  const doExport = async () => {
    if (!clips.length) { setError("Genera el Film Plan primero."); return; }
    setError(null);
    setExporting(true);
    setProgress(0);
    setDownloadUrl(null);
    setDownloadFormat(null);

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    const r = new FilmRenderer(canvas, exportConfig.aspect_ratio);
    r.setResolution(exportConfig.aspect_ratio, exportConfig.resolution);
    r.setTimeline(clips, totalDuration, "#000000");
    if (audioBuffer) r.setAudio(audioBuffer);

    try {
      // Precarga todas las imágenes.
      const hashes = clips.map((c) => c.hash).filter(Boolean);
      await loadBatchPreviews(hashes);
      for (const c of clips) await r._getImage(c.hash);

      // Intenta primero el renderer profesional (WebCodecs → MP4 determinista).
      let result = null;
      if (isWebCodecsAvailable()) {
        try {
          result = await exportWithWebCodecs(r, (p, t, tot) => setProgress(p));
        } catch (e) {
          console.warn("WebCodecs export failed, falling back to MediaRecorder", e);
          result = null;
        }
      }

      // Fallback: MediaRecorder (WebM en tiempo real).
      if (!result) {
        const blob = await r.export((t, tot) => setProgress(t / tot));
        result = { blob, format: "webm", mime: blob.type };
      }

      const url = URL.createObjectURL(result.blob);
      setDownloadUrl(url);
      setDownloadFormat(result.format);
      setProgress(1);
    } catch (e) {
      setError(e?.message || "Error al exportar el vídeo");
    } finally {
      setExporting(false);
      r.destroy();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold">Exportación</h3>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Aspecto</label>
          <select
            value={exportConfig.aspect_ratio}
            onChange={(e) => onChange({ ...exportConfig, aspect_ratio: e.target.value })}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Resolución</label>
          <select
            value={exportConfig.resolution}
            onChange={(e) => onChange({ ...exportConfig, resolution: e.target.value })}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="1080p">1080p (1920×1080)</option>
            <option value="4k">4K (3840×2160) — upscaling desde 2400px</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Formato</label>
          <div className="mt-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {availableFormat === "mp4" ? "MP4 (H.264+AAC)" :
             availableFormat === "webm" ? "WebM (VP9+Opus)" :
             "WebM (MediaRecorder)"}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {availableFormat === "mp4" ? "MP4 real vía WebCodecs. Determinista, sin frames perdidos." :
             availableFormat === "webm" ? "WebM vía WebCodecs. Determinista, sin frames perdidos." :
             "WebM en tiempo real. MP4 no soportado en este navegador."}
          </p>
        </div>
      </div>

      <button
        onClick={doExport}
        disabled={exporting || !clips.length}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-40"
      >
        {exporting ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Exportando… {Math.round(progress * 100)}%</>
        ) : (
          <><Download className="h-4 w-4" /> Exportar vídeo</>
        )}
      </button>

      {exporting && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {downloadUrl && !exporting && (
        <a
          href={downloadUrl}
          download={`emotive-film.${downloadFormat || "webm"}`}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/5"
        >
          <Download className="h-4 w-4" /> Descargar vídeo (.{downloadFormat || "webm"})
        </a>
      )}

      {downloadFormat === "mp4" && !exporting && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> MP4 real (H.264+AAC) — reproducible en cualquier dispositivo.
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}