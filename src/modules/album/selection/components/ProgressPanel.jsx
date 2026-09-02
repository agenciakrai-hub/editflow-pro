import React from "react";
import { Ban, Loader2 } from "lucide-react";

const STAGES = {
  e2: "Métricas técnicas locales",
  e3: "Agrupación de ráfagas",
  e4: "Triaje IA por lotes",
  e5: "Decisión por grupo",
  e6: "Momentos narrativos",
  e7: "Selección final",
};

// Bloque 8 — progreso por etapa con cancelación. El progreso se persiste en
// AlbumAISelection tras cada lote: cerrar la app NO destruye lo confirmado.
export default function ProgressPanel({ progress, onCancel }) {
  const stage = progress?.stage || "e2";
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin" /> Analizando…
      </div>
      <div className="mt-4 space-y-2">
        {Object.entries(STAGES).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (key === stage ? "animate-pulse bg-primary" : done && key < stage ? "bg-emerald-500" : "bg-muted-foreground/30")
              }
            />
            <span className={key === stage ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
            {key === stage && total > 0 && <span className="ml-auto tabular-nums text-muted-foreground">{done}/{total} · {pct}%</span>}
          </div>
        ))}
      </div>
      <button
        onClick={onCancel}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
      >
        <Ban className="h-3.5 w-3.5" /> Cancelar (lo completado se conserva)
      </button>
    </div>
  );
}