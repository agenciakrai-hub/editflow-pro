import { CheckCircle2, Sparkles, Pencil } from "lucide-react";
import { STATUS_LABEL } from "./PhotoFingerprintGrid";

// Resumen persistente de la selección guardada de un proyecto — para que el fotógrafo
// entienda de un vistazo qué decidió, aunque abra el proyecto días o semanas después.
export default function SelectionSummary({ fingerprints, onBackToSelection, onGoToEdit, editDisabled }) {
  const total = fingerprints.length;
  const counts = { TOP_PICK: 0, SELECT: 0, REVIEW: 0, REJECT: 0 };
  for (const f of fingerprints) counts[f.selection_status] = (counts[f.selection_status] || 0) + 1;
  const selectedCount = counts.TOP_PICK + counts.SELECT;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-accent">
        <CheckCircle2 className="h-5 w-5" />
        <p className="text-sm font-semibold">
          {total} fotografías analizadas · {selectedCount} seleccionadas
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <div key={key} className="rounded-lg border border-border px-3 py-2 text-center">
            <p className="text-lg font-semibold">{counts[key] || 0}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={onBackToSelection}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-3 text-sm font-semibold hover:bg-secondary"
        >
          <Pencil className="h-4 w-4" /> Volver a selección
        </button>
        <button
          onClick={onGoToEdit}
          disabled={editDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" /> Pasar a edición
        </button>
      </div>
    </div>
  );
}