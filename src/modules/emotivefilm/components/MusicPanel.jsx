// Panel de música: subir canción + análisis automático (BPM, duración, secciones).
import { useState, useRef } from "react";
import { Music, Loader2, X, FileAudio } from "lucide-react";
import { analyzeMusic, decodeAudioFile } from "../lib/musicAnalyzer";

export default function MusicPanel({ music, onChange, onAudioBuffer }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const analysis = await analyzeMusic(file);
      onChange(analysis);
      // Decodifica el audio para el reproductor (no se persiste: es un AudioBuffer
      // en memoria que vive solo en esta sesión).
      try {
        const buf = await decodeAudioFile(file);
        onAudioBuffer?.(buf);
      } catch {}
    } catch (e) {
      setError(e?.message || "No se pudo analizar la canción");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Music className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold">Música</h3>
      </div>

      {music ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <FileAudio className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 truncate text-sm font-medium">{music.name}</span>
            <button
              onClick={() => onChange(null)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary"
              title="Quitar canción"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Duración" value={formatDuration(music.duration_sec)} />
            <Stat label="BPM" value={music.bpm || "—"} />
            <Stat label="Clímax" value={formatDuration(music.climax_at)} />
          </div>
          {music.sections?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {music.sections.map((s, i) => (
                <span
                  key={i}
                  className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground"
                >
                  {s.name} · {s.intensity}%
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (e.target) e.target.value = "";
              handleFile(f);
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={analyzing}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {analyzing ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Analizando canción…</>
            ) : (
              <><Music className="h-4 w-4" /> + Añadir canción</>
            )}
          </button>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-secondary/50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}