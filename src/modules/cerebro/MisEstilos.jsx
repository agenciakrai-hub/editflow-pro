import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Wand2, X, History, GraduationCap, Camera, Clock, FileText } from "lucide-react";
import { listStyles, createStyle, deleteStyle, listCorrections } from "./hooks/useCerebroStore";
import { listPresets } from "./hooks/useCerebroStore";
import { useToast } from "@/components/ui/use-toast";

const CONFIDENCE_LABELS = { low: "Baja", medium: "Media", high: "Alta" };
const CONFIDENCE_COLORS = { low: "text-yellow-500", medium: "text-blue-500", high: "text-emerald-500" };

export default function MisEstilos() {
  const { toast } = useToast();
  const [styles, setStyles] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", preset_id: "", style_version: "v1" });
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([listStyles(), listPresets()]);
      setStyles(s);
      setPresets(p);
    } catch { setStyles([]); setPresets([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast({ title: "Falta el nombre del estilo", variant: "destructive" }); return; }
    if (!form.preset_id) { toast({ title: "Selecciona un preset base", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const preset = presets.find((p) => p.id === form.preset_id);
      await createStyle({
        name: form.name.trim(),
        preset_id: form.preset_id,
        preset_name: preset?.name || "",
        preset_version: preset?.version || "",
        style_version: form.style_version || "v1",
        correction_count: 0,
        confidence: "low",
        last_updated: new Date().toISOString(),
      });
      setShowForm(false);
      setForm({ name: "", preset_id: "", style_version: "v1" });
      toast({ title: "Estilo creado" });
      load();
    } catch (e) {
      toast({ title: "No se pudo crear", description: e?.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar este estilo y su aprendizaje?")) return;
    try { await deleteStyle(id); load(); } catch { toast({ title: "No se pudo eliminar", variant: "destructive" }); }
  };

  const openHistory = async (style) => {
    if (historyFor?.id === style.id) { setHistoryFor(null); return; }
    setHistoryFor(style);
    setLoadingHistory(true);
    try { setHistory(await listCorrections(style.id)); } catch { setHistory([]); }
    setLoadingHistory(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Un estilo es <span className="font-medium text-foreground">preset base + correcciones reales + aprendizaje acumulado</span>. No se crea uno nuevo por cada foto.
        </p>
        <button onClick={() => setShowForm((s) => !s)} disabled={!presets.length}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40">
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancelar" : "Nuevo estilo"}
        </button>
      </div>

      {!presets.length && !loading && (
        <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-600">
          Primero registra un preset en «Mis presets»; un estilo siempre se vincula a un preset concreto.
        </p>
      )}

      {showForm && (
        <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre del estilo</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Boda Editorial — Kiko" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Preset base</label>
              <select value={form.preset_id} onChange={(e) => setForm({ ...form, preset_id: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">—</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.version})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Versión del estilo</label>
              <input value={form.style_version} onChange={(e) => setForm({ ...form, style_version: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="v1" />
            </div>
          </div>
          <button disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear estilo
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : styles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Todavía no has creado ningún estilo.
        </div>
      ) : (
        <div className="space-y-3">
          {styles.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-accent" />
                  <div>
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Preset: {s.preset_name || "—"} {s.preset_version ? `· ${s.preset_version}` : ""} · Estilo {s.style_version}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openHistory(s)} className="text-muted-foreground hover:text-foreground" title="Historial de aprendizaje">
                    <History className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(s.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-md bg-secondary px-2.5 py-2">
                  <p className="text-muted-foreground flex items-center gap-1"><Camera className="h-3 w-3" /> Fotos procesadas</p>
                  <p className="mt-0.5 text-sm font-semibold">{s.photos_processed || 0}</p>
                </div>
                <div className="rounded-md bg-secondary px-2.5 py-2">
                  <p className="text-muted-foreground flex items-center gap-1"><History className="h-3 w-3" /> Correcciones</p>
                  <p className="mt-0.5 text-sm font-semibold">{s.correction_count || 0}</p>
                </div>
                <div className="rounded-md bg-secondary px-2.5 py-2">
                  <p className="text-muted-foreground flex items-center gap-1"><GraduationCap className="h-3 w-3" /> Aprendizaje</p>
                  <p className="mt-0.5 text-sm font-semibold">{s.learning_percentage || 0}%</p>
                </div>
                <div className="rounded-md bg-secondary px-2.5 py-2">
                  <p className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Confianza</p>
                  <p className={`mt-0.5 text-sm font-semibold ${CONFIDENCE_COLORS[s.confidence] || CONFIDENCE_COLORS.low}`}>
                    {CONFIDENCE_LABELS[s.confidence] || "Baja"}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Creado: {new Date(s.created_date).toLocaleDateString()}</span>
                {s.last_sync && <span>Última sincronización: {new Date(s.last_sync).toLocaleDateString()}</span>}
              </div>

              {s.initial_config && Object.keys(s.initial_config).length > 0 && (
                <div className="mt-2 rounded-md border border-border bg-background p-2">
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><FileText className="h-3 w-3" /> Configuración inicial</p>
                  <p className="mt-1 text-xs text-muted-foreground break-words">
                    {Object.entries(s.initial_config).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </p>
                </div>
              )}

              {historyFor?.id === s.id && (
                <div className="mt-3 rounded-md border border-border bg-background p-3">
                  {loadingHistory ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Cargando historial…</p>
                  ) : history.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin correcciones registradas todavía. El aprendizaje arrive desde Lightroom vía el plugin (lr-collect-corrections).</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {history.map((c) => (
                        <div key={c.id} className="text-xs text-muted-foreground border-b border-border pb-1.5 last:border-0">
                          <span className="font-medium text-foreground">{new Date(c.created_date).toLocaleDateString()}</span>
                          {c.delta && Object.keys(c.delta).length > 0 && (
                            <span className="ml-2">{Object.entries(c.delta).map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}`).join(" · ")}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}