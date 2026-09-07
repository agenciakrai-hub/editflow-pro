import { CheckCircle2, KeyRound, Loader2, Power } from "lucide-react";
import ResultCard from "./ResultCard";

// Tarjeta de proveedor integrado (Qwen, NVIDIA, Gemini) — API keys gestionadas como
// secrets de Base44. Muestra presencia de clave, endpoint/modelo, habilitación y prueba
// de conexión. Sirve para Selección IA y Ajustes IA.
export default function IntegratedProviderCard({
  title,
  icon: Icon,
  keyPresent,
  endpointValue,
  endpointPlaceholder,
  endpointHint,
  modelValue,
  modelPlaceholder,
  modelHint,
  enabled,
  enabledLabel,
  onEndpoint,
  onModel,
  onEnabled,
  onTest,
  testing,
  result,
  note,
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 space-y-4 ${keyPresent ? "" : "opacity-70"}`}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-accent" />}
        <p className="text-sm font-semibold">{title}</p>
        {keyPresent ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Disponible
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            <Power className="h-3 w-3" /> Apagado
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Endpoint base</label>
        <input
          value={endpointValue}
          onChange={(e) => onEndpoint(e.target.value)}
          placeholder={endpointPlaceholder}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">{endpointHint}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Modelo de visión</label>
        <input
          value={modelValue}
          onChange={(e) => onModel(e.target.value)}
          placeholder={modelPlaceholder}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">{modelHint}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
        {enabledLabel}
      </label>
      <div className="flex gap-3">
        <button onClick={onTest} disabled={testing}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Probar conexión
        </button>
      </div>
      {result && <ResultCard result={result} />}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}