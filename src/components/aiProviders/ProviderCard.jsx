import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Power, RefreshCw, Save, Search, Trash2, XCircle } from "lucide-react";

// Tarjeta de proveedor (unificada): badge de conexión, API key enmascarada con cambio
// de clave, lista buscable de modelos con casillas por tarea (Selección IA / Ajustes
// IA), encendido/apagado y borrado. Las selecciones de modelos NUNCA se guardan
// automáticamente: solo al pulsar "Guardar".
export default function ProviderCard({ provider, busyAction, onSaveModels, onRetest, onToggle, onDelete, onUpdateKey }) {
  const [search, setSearch] = useState("");
  const [selDraft, setSelDraft] = useState(provider.seleccion_models || []);
  const [ajDraft, setAjDraft] = useState(provider.ajustes_models || []);
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState("");

  const models = provider.available_models || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  }, [models, search]);

  const sameSet = (a, b) => {
    const x = a || [];
    const y = b || [];
    return x.length === y.length && x.every((m) => y.includes(m));
  };
  const dirty = !sameSet(selDraft, provider.seleccion_models) || !sameSet(ajDraft, provider.ajustes_models);
  const busy = (action) => busyAction?.id === provider.id && busyAction?.action === action;

  const toggleModel = (task, model) => {
    const setDraft = task === "seleccion" ? setSelDraft : setAjDraft;
    setDraft((d) => (d.includes(model) ? d.filter((m) => m !== model) : [...d, model]));
  };

  const saveKey = async () => {
    const ok = await onUpdateKey(provider.id, newKey);
    if (ok) {
      setNewKey("");
      setShowKey(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{provider.name}</p>
            {provider.last_ok ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Conectado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                <XCircle className="h-3 w-3" /> Sin conexión
              </span>
            )}
            {!provider.enabled && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">Deshabilitado</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {provider.endpoint} · API key {provider.masked_key || "—"}
            {provider.builtin_secret && !provider.has_own_key ? ` (secret ${provider.builtin_secret})` : ""}
          </p>
          {provider.last_reason && <p className="mt-0.5 text-xs text-red-500">{provider.last_reason}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => onRetest(provider.id)} disabled={busy("retest")} title="Re-test de conexión"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40">
            {busy("retest") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-test
          </button>
          <button onClick={() => onToggle(provider.id, !provider.enabled)} title={provider.enabled ? "Deshabilitar" : "Habilitar"}
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary">
            <Power className={`h-3.5 w-3.5 ${provider.enabled ? "text-emerald-600" : "text-muted-foreground"}`} />
          </button>
          <button onClick={() => onDelete(provider.id, provider.name)} title="Eliminar"
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-destructive hover:bg-destructive/5">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Cambio de API key */}
      <div className="space-y-2">
        <button onClick={() => setShowKey((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline">
          <KeyRound className="h-3.5 w-3.5" /> {showKey ? "Ocultar cambio de clave" : "Cambiar API key"}
        </button>
        {showKey && (
          <div className="flex gap-2">
            <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)}
              placeholder="Nueva API key (sk-…)"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <button onClick={saveKey} disabled={!newKey.trim() || busy("key")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {busy("key") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar clave
            </button>
          </div>
        )}
      </div>

      {models.length > 0 ? (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar modelo…"
              className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            <div className="flex items-center gap-3 bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="flex-1">Modelo ({filtered.length}{filtered.length !== models.length ? ` de ${models.length}` : ""})</span>
              <span className="w-20 text-center">Selección</span>
              <span className="w-20 text-center">Ajustes</span>
            </div>
            {filtered.map((m) => (
              <div key={m} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{m}</span>
                <label className="flex w-20 items-center justify-center gap-1 text-xs">
                  <input type="checkbox" checked={selDraft.includes(m)} onChange={() => toggleModel("seleccion", m)} />
                </label>
                <label className="flex w-20 items-center justify-center gap-1 text-xs">
                  <input type="checkbox" checked={ajDraft.includes(m)} onChange={() => toggleModel("ajustes", m)} />
                </label>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Ningún modelo coincide con la búsqueda.</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => onSaveModels(provider.id, selDraft, ajDraft)} disabled={!dirty || busy("save")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {busy("save") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
            </button>
            <p className="text-xs text-muted-foreground">
              Marca qué modelos usar para Selección IA y Ajustes IA. La selección solo se guarda al pulsar Guardar.
            </p>
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Sin modelos detectados. Pulsa Re-test para verificar la conexión y obtener la lista de modelos.
        </p>
      )}
    </div>
  );
}