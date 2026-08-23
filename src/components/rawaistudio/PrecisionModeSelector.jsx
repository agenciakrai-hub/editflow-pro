import { PRECISION_MODES } from "@/lib/rawaistudio/exposureEngine";

export default function PrecisionModeSelector({ value, onChange }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2">
      <p className="text-sm text-zinc-200">Precisión del revelado</p>
      <p className="mt-1 text-xs text-zinc-500">
        Cuánto puede desplazarse el motor técnico respecto a la medición fotométrica real de cada foto.
      </p>
      <div className="mt-2 flex gap-2">
        {Object.entries(PRECISION_MODES).map(([key, cfg]) => (
          <button key={key} type="button" onClick={() => onChange(key)}
            className={`rounded-md border px-3 py-1.5 text-xs ${value === key ? "border-white bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-400"}`}>
            {cfg.label}
          </button>
        ))}
      </div>
    </div>
  );
}