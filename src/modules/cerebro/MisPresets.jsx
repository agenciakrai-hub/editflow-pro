import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, FileImage, Calendar, X } from "lucide-react";
import { listPresets, createPreset, deletePreset } from "./hooks/useCerebroStore";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

const TYPE_LABELS = { lightroom: "Lightroom", camera_profile: "Perfil cámara", custom: "Personalizado" };

export default function MisPresets() {
  const { toast } = useToast();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", version: "v1", preset_type: "lightroom", description: "", file: null });

  const load = async () => {
    setLoading(true);
    try { setPresets(await listPresets()); } catch { setPresets([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast({ title: "Falta el nombre del preset", variant: "destructive" }); return; }
    setSaving(true);
    try {
      let fileUrl = "";
      if (form.file) {
        const res = await base44.integrations.Core.UploadFile({ file: form.file });
        fileUrl = res.file_url;
      }
      await createPreset({
        name: form.name.trim(),
        version: form.version || "v1",
        preset_type: form.preset_type,
        preset_file_url: fileUrl,
        preset_identifier: fileUrl || (crypto.randomUUID?.() ?? String(Date.now())),
        incorporated_date: new Date().toISOString().slice(0, 10),
        description: form.description,
      });
      setShowForm(false);
      setForm({ name: "", version: "v1", preset_type: "lightroom", description: "", file: null });
      toast({ title: "Preset registrado" });
      load();
    } catch (e) {
      toast({ title: "No se pudo registrar", description: e?.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const remove = async (id) => {
    if (!window.confirm("¿Eliminar este preset?")) return;
    try { await deletePreset(id); load(); } catch (e) { toast({ title: "No se pudo eliminar", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Registra tus presets una sola vez. Subir un preset aquí no lo aplica ni modifica los motores.
        </p>
        <button onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground">
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cancelar" : "Registrar preset"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Boda Editorial" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Versión</label>
              <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="v3" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <select value={form.preset_type} onChange={(e) => setForm({ ...form, preset_type: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="lightroom">Lightroom</option>
                <option value="camera_profile">Perfil de cámara</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Archivo (.xmp / .lrtemplate)</label>
              <input type="file" accept=".xmp,.lrtemplate"
                onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
                className="mt-1 w-full text-sm file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Descripción (opcional)</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2} />
          </div>
          <button disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Guardar preset
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : presets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Todavía no has registrado ningún preset.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {presets.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <FileImage className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.version} · {TYPE_LABELS[p.preset_type]}</p>
                  </div>
                </div>
                <button onClick={() => remove(p.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {p.description && <p className="mt-2 text-xs text-muted-foreground">{p.description}</p>}
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" /> {p.incorporated_date || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}