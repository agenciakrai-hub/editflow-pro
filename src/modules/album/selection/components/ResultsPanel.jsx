import React, { useEffect, useState } from "react";
import { Check, EyeOff, Loader2, Lock, RefreshCw, Star, Undo2, X } from "lucide-react";
import { getTierPreview } from "@/modules/album/lib/previewStore";

// Bloque 10 — resultados con EXPLICACIONES y control del fotógrafo. La IA solo
// analiza, recomienda y explica: NUNCA elimina fotos. Los overrides del
// fotógrafo tienen JERARQUÍA sobre la IA (forced/blocked jamás se sobrescriben).
const OVERRIDES = [
  { action: "accept", label: "Aceptar", icon: Star },
  { action: "reject", label: "Descartar", icon: X },
  { action: "recover", label: "Recuperar", icon: Undo2 },
  { action: "force_include", label: "Forzar inclusión", icon: RefreshCw },
  { action: "block", label: "Bloquear", icon: Lock },
];

export default function ResultsPanel({ project, selectionJob, photos, onOverride, onAcceptAll, acceptAllBusy }) {
  const [thumbs, setThumbs] = useState({});
  const photosById = new Map(photos.map((p) => [p.id, p]));
  const entries = selectionJob?.selection || [];

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = {};
      await Promise.all(
        entries.slice(0, 200).map(async (s) => {
          const t = await getTierPreview(project.id, s.photo_id, "thumb");
          if (t) next[s.photo_id] = t;
        })
      );
      if (alive) setThumbs(next);
    })();
    return () => {
      alive = false;
    };
  }, [project.id, entries.length]);

  const funnel = selectionJob?.funnel_report || {};
  const stats = selectionJob?.stats || null;
  const missingCount = (stats?.failed_no_preview || 0) + (stats?.failed_no_response || 0);
  const partial = !!(stats?.photo_count && stats.analyzed != null && stats.analyzed < stats.photo_count);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          Selección propuesta · {entries.length} fotos
          {selectionJob?.stats?.provider_used && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              IA: {selectionJob.stats.provider_used}
            </span>
          )}
          <button
            onClick={() => onAcceptAll?.()}
            disabled={acceptAllBusy || !entries.length}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {acceptAllBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Aceptar todas
          </button>
        </div>
        {funnel.coverage && <p className="mt-1 text-muted-foreground">Cobertura: {funnel.coverage}</p>}
        {funnel.notes && <p className="mt-1 text-muted-foreground">{funnel.notes}</p>}
        {stats?.photo_count ? (
          <p className="mt-1 text-muted-foreground">
            Catálogo: {stats.photo_count} · Analizadas: {stats.analyzed ?? "—"} · Seleccionadas: {entries.length}
            {missingCount > 0 ? ` · Sin analizar: ${missingCount}` : ""}
          </p>
        ) : null}
        {partial && (
          <p className="mt-1 text-amber-600">
            Análisis parcialmente completado — {missingCount} fotografía(s) no pudieron analizarse (sin preview en este dispositivo o sin respuesta de la IA). Pulsa «Re-ejecutar selección» para reintentarlas.
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          La IA no elimina fotografías: solo recomienda y explica. Tus decisiones manuales prevalecen siempre sobre la IA.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {entries.map((s) => {
          const photo = photosById.get(s.photo_id);
          const state = photo?.ai_state || "unreviewed";
          const isOverride = photo?.ai_override === "forced" || photo?.ai_override === "blocked";
          return (
            <div key={s.photo_id} className={`overflow-hidden rounded-lg border border-border bg-card ${state === "discarded" ? "opacity-60" : ""}`}>
              <div className="relative aspect-4/3 bg-neutral-200">
                {thumbs[s.photo_id] ? (
                  <img src={thumbs[s.photo_id]} alt={photo?.filename || ""} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-neutral-400"><EyeOff className="h-5 w-5" /></div>
                )}
                <span className="absolute left-1 top-1 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                  {s.role}{s.tech_exception ? " · excepción técnica" : ""}
                </span>
                {isOverride && <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">override</span>}
              </div>
              <div className="space-y-1 p-2">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-[11px] font-medium">{photo?.filename || "Foto"}</p>
                  {state === "recommended" && <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">aceptada</span>}
                  {state === "considered" && <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-secondary-foreground">recuperada</span>}
                  {state === "discarded" && <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">descartada</span>}
                </div>
                {s.moment && <p className="truncate text-[10px] text-muted-foreground">{s.moment}</p>}
                {s.reasons && <p className="line-clamp-2 text-[10px] text-muted-foreground">{s.reasons}</p>}
                <div className="flex flex-wrap gap-1 pt-1">
                  {OVERRIDES.map(({ action, label, icon: Icon }) => (
                    <button
                      key={action}
                      title={label}
                      disabled={!photo || (photo.ai_override === "blocked" && action !== "recover") || state === "discarded" && action === "reject"}
                      onClick={() => onOverride(photo, action)}
                      className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-30"
                    >
                      <Icon className="inline h-3 w-3" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}