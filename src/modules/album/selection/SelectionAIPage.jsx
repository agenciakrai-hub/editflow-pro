import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, PlayCircle, ShieldOff, Sparkles } from "lucide-react";
import { getAlbum, listPhotos } from "@/modules/album/hooks/useAlbumProject";
import { useAiSelection } from "@/modules/album/selection/useAiSelection";
import ConsentPanel from "@/modules/album/selection/components/ConsentPanel";
import ProgressPanel from "@/modules/album/selection/components/ProgressPanel";
import ResultsPanel from "@/modules/album/selection/components/ResultsPanel";
import ProvidersPanel from "@/modules/album/selection/components/ProvidersPanel";
import { useToast } from "@/components/ui/use-toast";

const STAGE_LABEL = {
  e2: "Métricas locales",
  e3: "Grupos",
  e4: "Triaje IA",
  e5: "Grupos IA",
  e6: "Momentos",
  e7: "Selección",
  done: "Completado",
};

export default function SelectionAIPage({ projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const project = await getAlbum(projectId);
        const photos = await listPhotos(projectId);
        if (alive) setData({ project, photos });
      } catch (e) {
        if (alive) setError(e?.message || "No se pudo cargar el álbum");
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="space-y-3">
        <Link to="/album" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
          <ArrowLeft className="h-3.5 w-3.5" /> Álbumes
        </Link>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;
  }
  return <SelectionInner key={projectId} {...data} />;
}

function SelectionInner({ project, photos: initialPhotos }) {
  const [photos, setPhotos] = useState(initialPhotos);
  const { toast } = useToast();
  const { config, needsConsent, selection, progress, running, error, acceptConsent, revoke, start, cancel, override } = useAiSelection(project, photos);

  const estimates = useMemo(() => {
    const withThumb = photos.length;
    const e4 = Math.ceil(withThumb / 20);
    const groups = Math.max(1, Math.round(withThumb / 3));
    return { calls: e4 + groups + 2, mb: Math.round((withThumb * 60 * 1024) / (1024 * 1024) * 10) / 10 || 0.1 };
  }, [photos.length]);

  const hasResults = selection?.status === "completed" && (selection.selection?.length || 0) > 0;
  const canResume = ["canceled", "failed"].includes(selection?.status);
  const iconBtn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40";

  const handleAccept = async ({ save }) => {
    await acceptConsent({ save });
    await start();
  };

  // Aplica la decisión del fotógrafo, refresca la foto EN PANTALLA y da feedback.
  // Antes el guardado funcionaba pero la UI no reflejaba nada: parecía roto.
  const handleOverride = async (photo, action) => {
    try {
      const updated = await override(photo, action);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, ...(updated || {}) } : p)));
      toast({ title: "Decisión aplicada", description: `${photo.filename}: tu decisión manual está guardada y prevalece sobre la IA.` });
    } catch (e) {
      toast({ title: "No se pudo aplicar la decisión", description: e?.message || String(e), variant: "destructive" });
    }
  };

  // Aceptar todas las fotos de la propuesta de una vez.
  const [acceptingAll, setAcceptingAll] = useState(false);
  const handleAcceptAll = async () => {
    const entries = selection?.selection || [];
    if (!entries.length || acceptingAll) return;
    setAcceptingAll(true);
    try {
      await Promise.all(
        entries.map((s) => {
          const photo = photos.find((p) => p.id === s.photo_id);
          return photo ? override(photo, "accept") : Promise.resolve(null);
        })
      );
      const ids = new Set(entries.map((s) => s.photo_id));
      setPhotos((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, ai_state: "recommended" } : p)));
      toast({ title: "Todas aceptadas", description: `${entries.length} fotografías de la propuesta marcadas como aceptadas.` });
    } catch (e) {
      toast({ title: "No se pudo aplicar", description: e?.message || String(e), variant: "destructive" });
    }
    setAcceptingAll(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/album?project=${project.id}`} className={iconBtn}><ArrowLeft className="h-3.5 w-3.5" /> Editor</Link>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Selección IA · {project.name}</h1>
          <p className="text-xs text-muted-foreground">
            {photos.length} fotos en el catálogo
            {selection && ` · último trabajo: ${STAGE_LABEL[selection.stage] || selection.stage} (${selection.status})`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {config?.consent_mode === "saved" && config?.revoked !== true && (
            <button onClick={revoke} className={iconBtn}><ShieldOff className="h-3.5 w-3.5" /> Revocar consentimiento</button>
          )}
          {!needsConsent && !running && (
            <button onClick={start} className={iconBtn}>
              <PlayCircle className="h-3.5 w-3.5" /> {canResume || hasResults ? "Re-ejecutar selección" : "Analizar con IA"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {needsConsent && !running && (
        <ConsentPanel photoCount={photos.length} estimates={estimates} busy={running} onAccept={handleAccept} />
      )}

      {running && <ProgressPanel progress={progress} onCancel={cancel} />}

      {hasResults && (
        <ResultsPanel
          project={project}
          selectionJob={selection}
          photos={photos}
          onOverride={handleOverride}
          onAcceptAll={handleAcceptAll}
          acceptAllBusy={acceptingAll}
        />
      )}

      {selection?.status === "failed" && !running && (
        <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          El último trabajo falló: {selection.error}. Pulsa «Re-ejecutar selección» para reanudar desde donde quedó (los lotes completados no se repiten).
        </div>
      )}

      {photos.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Importa fotos en el editor antes de ejecutar la selección IA.
        </div>
      )}

      <ProvidersPanel />
    </div>
  );
}