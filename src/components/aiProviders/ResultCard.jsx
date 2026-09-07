// Resultado de una prueba de conexión: trazabilidad del ping (proveedor, modelo,
// endpoint, estado HTTP, latencia). Nunca contiene la API key.
export default function ResultCard({ result }) {
  const fields = [
    ["provider", result.provider],
    ["ok", String(result.ok)],
    ["model", result.model],
    ["endpoint", result.endpoint],
    ["http_status", result.http_status != null ? String(result.http_status) : "—"],
    ["latency_ms", result.latency_ms != null ? String(result.latency_ms) : "—"],
    ["key_present", String(result.key_present)],
    ["via_invoke_llm", String(result.via_invoke_llm)],
  ];
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2 text-sm">
      <p className="font-semibold">Resultado</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {fields.map(([label, value]) => (
          <div key={label}>
            <p className="text-muted-foreground">{label}</p>
            <p className="font-mono break-all">{value || "—"}</p>
          </div>
        ))}
      </div>
      {result.reason && <p className="text-red-500 text-xs">Razón: {result.reason}</p>}
      {result.response_preview && (
        <p className="text-xs text-muted-foreground break-all">Respuesta: {result.response_preview}</p>
      )}
    </div>
  );
}