import { useState } from "react";
import { CheckCircle2, Loader2, Plus } from "lucide-react";

// Formulario minimalista para añadir un proveedor IA: solo piden la URL del dominio y
// la API key. El backend autodetecta el nombre desde el dominio, normaliza la URL,
// verifica la conexión (GET /models) y guarda todos los modelos disponibles.
export default function AddProviderForm({ onAdd, adding, result }) {
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!endpoint.trim() || !apiKey.trim()) return;
    const ok = await onAdd({ endpoint: endpoint.trim(), api_key: apiKey.trim() });
    if (ok) {
      setEndpoint("");
      setApiKey("");
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-accent" />
        <p className="text-sm font-semibold">Añadir proveedor IA</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Introduce la URL del proveedor (compatible OpenAI) y su API key. La app detecta el nombre, verifica la conexión
        y muestra todos los modelos disponibles para que marques cuáles usar en Selección IA y Ajustes IA.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">URL del proveedor</label>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://openrouter.ai"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={adding || !endpoint.trim() || !apiKey.trim()}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Añadir y verificar
      </button>
      {result && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          No se pudo añadir: {result}
        </div>
      )}
    </form>
  );
}