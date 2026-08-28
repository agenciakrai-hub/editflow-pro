// Lista de estilos guardados del usuario: seleccionar para ver detalle / eliminar.
import { Trash2, Eye } from "lucide-react";

export default function StyleList({ styles, selectedId, onSelect, onDelete }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {styles.map((s) => (
        <div
          key={s.id}
          className={`rounded-xl border bg-card p-4 transition-colors ${
            selectedId === s.id ? "border-accent" : "border-border"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{s.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Confianza: {s.confidence ?? 0}% · {s.source?.provider || "—"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onSelect(s)}
                className="p-1.5 rounded-lg hover:bg-secondary"
                aria-label="Ver detalle"
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                onClick={() => onDelete(s.id)}
                className="p-1.5 rounded-lg hover:bg-secondary text-destructive"
                aria-label="Eliminar"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}