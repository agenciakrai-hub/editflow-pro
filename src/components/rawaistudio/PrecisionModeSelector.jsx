import { PRECISION_MODES } from "@/lib/rawaistudio/exposureEngine";

export default function PrecisionModeSelector({ value, onChange }) {
  return (
    <div className="rounded-md border border-border bg-secondary px-3 py-2">
      <p className="text-sm text-foreground">Precisión del revelado</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Cuánto puede desplazarse el motor técnico respecto a la medición fotométrica real de cada foto.
      </p>
      <div className="mt-2 flex gap-2">
        {Object.entries(PRECISION_MODES).map(([key, cfg]) => (
          <button key={key} type="button" onClick={() => onChange(key)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${value === key ? "border-foreground bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-card"}`}>
            {cfg.label}
          </button>
        ))}
      </div>
    </div>
  );
}