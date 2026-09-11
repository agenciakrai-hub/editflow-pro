import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Power, RefreshCw, RotateCw, Save, Search, Trash2, XCircle } from "lucide-react";
import { checkboxState, taskCandidate } from "@/lib/ai/modelCapabilities";

// Tarjeta de proveedor (unificada). Las casillas de modelo/tarea se habilitan o
// deshabilitan según las capacidades RESUELTAS (available_models_meta), que son la
// fuente única de verdad generada por el backend (base44/shared/modelCapabilities.ts
// + prueba empírica "Probar capacidad"). El frontend NO clasifica por nombre.
//
// Tres estados de casilla:
//   - compatible / compatible_marked → habilitada (marcada o no).
//   - incompatible → deshabilitada (verificado NO compatible).
//   - unverified → deshabilitada (sin evidencia); muestra "Probar capacidad".
//   - marked_unverified → deshabilitada pero marcada (config antigua preservada; avisa
//     de que no se ejecutará hasta verificar).
const TABS = [
  { id: "todos", label: "Todos" },
  { id: "seleccion", label: "Selección" },
  { id: "edicion", label: "Edición" },
  { id: "video", label: "Vídeo" },
  { id: "album", label: "Álbum" },
];

const COLS = ["seleccion", "ajustes", "edicion", "video", "album"];
const COL_LABELS = {
  seleccion: "Selección",
  ajustes: "Ajustes",
  edicion: "Edición",
  video: "Vídeo",
  album: "Álbum",
};

export default function ProviderCard({ provider, busyAction, onSaveModels, onRetest, onToggle, onDelete, onUpdateKey }) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("todos");
  const [selDraft, setSelDraft] = useState(provider.seleccion_models || []);
  const [ajDraft, setAjDraft] = useState(provider.ajustes_models || []);
  const [edDraft, setEdDraft] = useState(provider.edicion_models || []);
  const [vidDraft, setVidDraft] = useState(provider.video_models || []);
  const [albDraft, setAlbDraft] = useState(provider.album_models || []);
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState("");

  const models = provider.available_models || [];
  const metaMap = useMemo(() => {
    const m = new Map();
    for (const e of (provider.available_models_meta || [])) {
      if (e?.id) m.set(e.id, e);
    }
    return m;
  }, [provider.available_models_meta]);
  const metaOf = (modelId) => metaMap.get(modelId) || null;
  const visionState = (modelId) => metaOf(modelId)?.caps?.vision ?? null;

  const tabCounts = useMemo(() => {
    const c = { todos: models.length, seleccion: 0, edicion: 0, video: 0, album: 0 };
    for (const m of models) {
      const e = metaOf(m);
      // Candidatos por herramienta: compatibles (true) o no verificados (null).
      // Los verificados como NO compatibles (false) quedan fuera de la pestaña.
      if (taskCandidate(e, "seleccion")) c.seleccion += 1;
      if (taskCandidate(e, "edicion")) c.edicion += 1;
      if (taskCandidate(e, "video")) c.video += 1;
      if (taskCandidate(e, "album")) c.album += 1;
    }
    return c;
  }, [models, metaMap]);

  const filtered = useMemo(() => {
    let list = models;
    if (tab === "seleccion") list = list.filter((m) => taskCandidate(metaOf(m), "seleccion"));
    else if (tab === "edicion") list = list.filter((m) => taskCandidate(metaOf(m), "edicion"));
    else if (tab === "video") list = list.filter((m) => taskCandidate(metaOf(m), "video"));
    else if (tab === "album") list = list.filter((m) => taskCandidate(metaOf(m), "album"));
    const q = search.trim().toLowerCase();
    return q ? list.filter((m) => m.toLowerCase().includes(q)) : list;
  }, [models, search, tab, metaMap]);

  const sameSet = (a, b) => {
    const x = a || [];
    const y = b || [];
    return x.length === y.length && x.every((m) => y.includes(m));
  };
  const dirty =
    !sameSet(selDraft, provider.seleccion_models) ||
    !sameSet(ajDraft, provider.ajustes_models) ||
    !sameSet(edDraft, provider.edicion_models) ||
    !sameSet(vidDraft, provider.video_models) ||
    !sameSet(albDraft, provider.album_models);
  const busy = (action) => busyAction?.id === provider.id && busyAction?.action === action;

  const drafts = {
    seleccion: { get: selDraft, set: setSelDraft },
    ajustes: { get: ajDraft, set: setAjDraft },
    edicion: { get: edDraft, set: setEdDraft },
    video: { get: vidDraft, set: setVidDraft },
    album: { get: albDraft, set: setAlbDraft },
  };
  const toggleModel = (task, model) => {
    drafts[task].set((d) => (d.includes(model) ? d.filter((m) => m !== model) : [...d, model]));
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
          <button onClick={() => onRetest(provider.id)} disabled={busy("retest") || busy("reclassify")} title="Re-test: refresca modelos y clasifica capacidades automáticamente (A→B→C). Los modelos ya clasificados no se vuelven a probar."
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40">
            {busy("retest") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-test
          </button>
          <button onClick={() => onRetest(provider.id, true)} disabled={busy("retest") || busy("reclassify")} title="Reclasificar: vuelve a sondear TODOS los modelos (incluidos los ya clasificados). Úsalo solo si crees que una clasificación es incorrecta."
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40">
            {busy("reclassify") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Reclasificar
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
          {/* Pestañas por capacidad: filtran la lista a los modelos de cada tipo */}
          <div className="flex flex-wrap items-center gap-1.5">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                title={
                  t.id === "todos" ? "Todos los modelos del proveedor"
                  : t.id === "seleccion" ? "Candidatos para Selección: compatibles (visión verificada/declarada) o sin verificar. Excluidos los verificados como NO compatibles."
                  : t.id === "edicion" ? "Candidatos para Edición: compatibles (image_edit) o sin verificar."
                  : t.id === "video" ? "Candidatos para Vídeo: compatibles (video) o sin verificar."
                  : "Candidatos para Álbum: compatibles (visión) o sin verificar."
                }
                className={"rounded-full px-3 py-1.5 text-xs font-medium " + (tab === t.id ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary")}>
                {t.label} <span className={tab === t.id ? "opacity-70" : "text-muted-foreground"}>({tabCounts[t.id] ?? 0})</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar modelo…"
              className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            <div className="flex items-center gap-2 bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="min-w-0 flex-1">Modelo ({filtered.length}{filtered.length !== models.length ? ` de ${models.length}` : ""})</span>
              {COLS.map((c) => (
                <span key={c} className="w-16 text-center">{COL_LABELS[c]}</span>
              ))}
              <span className="w-20 text-center">Visión</span>
            </div>
            {filtered.map((m) => {
              const e = metaOf(m);
              const vState = visionState(m);
              const probeStatus = e?.probe_status;
              return (
                <div key={m} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{m}</p>
                    {vState === true && (
                      <span className="text-[10px] text-emerald-600">Visión verificada</span>
                    )}
                    {vState === false && (
                      <span className="text-[10px] text-red-500">Visión rechazada</span>
                    )}
                    {vState === null && probeStatus === "error" && (
                      <span className="text-[10px] text-amber-600">Prueba con error</span>
                    )}
                    {vState === null && probeStatus !== "error" && (
                      <span className="text-[10px] text-amber-600">Sin verificar</span>
                    )}
                  </div>
                  {COLS.map((c) => {
                    const marked = drafts[c].get.includes(m);
                    const st = checkboxState(e, c, marked);
                    const enabled = st === "compatible" || st === "compatible_marked";
                    const title =
                      st === "incompatible" ? "Verificado como NO compatible con esta herramienta"
                      : st === "unverified" ? "Capacidad no verificada. Prueba el modelo (Probar capacidad) para habilitar esta herramienta."
                      : st === "marked_unverified" ? "Marcado pero no verificado como compatible — no se ejecutará hasta verificar. Pulsa Probar capacidad."
                      : "";
                    return (
                      <label key={c} className={"flex w-16 items-center justify-center " + (st === "marked_unverified" ? "text-amber-500" : "")} title={title}>
                        <input
                          type="checkbox"
                          checked={marked}
                          disabled={!enabled}
                          onChange={() => enabled && toggleModel(c, m)}
                          className={st === "marked_unverified" ? "accent-amber-500" : ""}
                        />
                      </label>
                    );
                  })}
                  <div className="flex w-20 items-center justify-center">
                    {vState === false && <XCircle className="h-3.5 w-3.5 text-red-400" title="Visión rechazada" />}
                    {vState === true && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" title="Visión verificada" />}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {tab === "todos"
                  ? "Ningún modelo coincide con la búsqueda."
                  : tab === "seleccion" || tab === "album"
                    ? "Ningún modelo candidato para visión (todos verificados como NO compatibles)."
                    : "Ningún modelo candidato para esta capacidad (todos verificados como NO compatibles)."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => onSaveModels(provider.id, selDraft, ajDraft, edDraft, vidDraft, albDraft)} disabled={!dirty || busy("save")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              {busy("save") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
            </button>
            <p className="text-xs text-muted-foreground">
              Las casillas se habilitan solo si el modelo es compatible (visión verificada o declarada). Los modelos «Sin verificar» se clasifican automáticamente al pulsar Re-test. La selección solo se guarda al pulsar Guardar.
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