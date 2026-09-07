import { useEffect, useState } from "react";
import { Cpu, KeyRound, Loader2, Save, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import AddProviderForm from "@/components/aiProviders/AddProviderForm";
import ProviderCard from "@/components/aiProviders/ProviderCard";
import IntegratedProviderCard from "@/components/aiProviders/IntegratedProviderCard";

// Proveedores IA V2 — admin. UNA sola herramienta para añadir proveedores de IA: URL +
// API key → la app verifica la conexión, muestra TODOS los modelos disponibles y el
// administrador marca cuáles sirven para Selección IA y cuáles para Ajustes IA.
// Los proveedores integrados (Qwen, NVIDIA, Gemini) usan API keys como secrets de
// Base44; los propios se almacenan en CustomAiProvider (admin-only) y se enrutan como
// proveedores OpenAI-compatible de visión.
const EMPTY_FORM = {
  qwen_enabled: false,
  qwen_endpoint: "",
  qwen_model: "qwen3-vl-plus",
  nvidia_enabled: false,
  nvidia_endpoint: "https://integrate.api.nvidia.com/v1",
  nvidia_model: "minimaxai/minimax-m3",
  gemini_enabled: false,
  gemini_endpoint: "https://generativelanguage.googleapis.com/v1beta",
  gemini_model: "gemini-2.5-flash",
  active_seleccion: "base44",
  active_ajustes: "qwen",
};

export default function AIProviders() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [keys, setKeys] = useState({ qwen: false, nvidia: false, gemini: false });
  const [providers, setProviders] = useState([]);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [testing, setTesting] = useState({ qwen: false, nvidia: false, gemini: false });
  const [results, setResults] = useState({ qwen: null, nvidia: null, gemini: null });

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "get-config" });
      const data = res?.data ?? res;
      setKeys({ qwen: !!data.qwen_key_present, nvidia: !!data.nvidia_key_present, gemini: !!data.gemini_key_present });
      if (data.config) setForm((f) => ({ ...f, ...data.config }));
      const resList = await base44.functions.invoke("ai-providers", { action: "list" });
      const dataList = resList?.data ?? resList;
      setProviders(Array.isArray(dataList?.providers) ? dataList.providers : []);
    } catch (e) {
      toast({ title: "Error al cargar", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ---- Proveedores propios ----
  const addProvider = async ({ endpoint, api_key }) => {
    setAdding(true);
    setAddResult(null);
    let ok = false;
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "add", endpoint, api_key });
      const data = res?.data ?? res;
      if (data.ok) {
        setProviders((prev) => [data.provider, ...prev]);
        toast({ title: "Proveedor añadido", description: `${data.provider.name}: ${data.total_models} modelos disponibles. Marca cuáles usar y pulsa Guardar.` });
        ok = true;
      } else {
        setAddResult(data.reason || "No se pudo verificar la conexión");
      }
    } catch (e) {
      setAddResult(e.message);
    }
    setAdding(false);
    return ok;
  };

  const saveModels = async (id, seleccion_models, ajustes_models) => {
    setBusyAction({ id, action: "save" });
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "update-models", id, seleccion_models, ajustes_models });
      const data = res?.data ?? res;
      if (data.ok) {
        setProviders((prev) => prev.map((p) => (p.id === id ? data.provider : p)));
        toast({ title: "Selección de modelos guardada" });
      }
    } catch (e) {
      toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" });
    }
    setBusyAction(null);
  };

  const retestProvider = async (id) => {
    setBusyAction({ id, action: "retest" });
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "retest", id });
      const data = res?.data ?? res;
      if (data.provider) setProviders((prev) => prev.map((p) => (p.id === id ? data.provider : p)));
      toast({
        title: data.ok ? "Conexión correcta" : "Falló la conexión",
        description: data.ok ? `${data.total_models} modelos detectados` : data.reason,
        variant: data.ok ? "default" : "destructive",
      });
    } catch (e) {
      toast({ title: "Falló la conexión", description: e.message, variant: "destructive" });
    }
    setBusyAction(null);
  };

  const toggleProvider = async (id, enabled) => {
    try {
      await base44.functions.invoke("ai-providers", { action: "toggle", id, enabled });
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
    } catch (e) {
      toast({ title: "No se pudo cambiar", description: e.message, variant: "destructive" });
    }
  };

  const deleteProvider = async (id, name) => {
    if (!window.confirm(`¿Eliminar el proveedor "${name}"? Si estaba activo en Selección o Ajustes, vuelve a Base44.`)) return;
    try {
      await base44.functions.invoke("ai-providers", { action: "delete", id });
      setProviders((prev) => prev.filter((p) => p.id !== id));
      setForm((f) => ({
        ...f,
        active_seleccion: f.active_seleccion === `custom:${id}` ? "base44" : f.active_seleccion,
        active_ajustes: f.active_ajustes === `custom:${id}` ? "base44" : f.active_ajustes,
      }));
      toast({ title: "Proveedor eliminado" });
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" });
    }
  };

  // ---- Proveedores integrados ----
  const testIntegrated = async (provider) => {
    setTesting((t) => ({ ...t, [provider]: true }));
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection", provider });
      setResults((r) => ({ ...r, [provider]: res?.data ?? res }));
    } catch (e) {
      setResults((r) => ({ ...r, [provider]: { ok: false, reason: e.message } }));
    }
    setTesting((t) => ({ ...t, [provider]: false }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "save-config", ...form });
      const data = res?.data ?? res;
      setKeys({ qwen: !!data.qwen_key_present, nvidia: !!data.nvidia_key_present, gemini: !!data.gemini_key_present });
      toast({ title: "Configuración guardada" });
    } catch (e) {
      toast({ title: "Error al guardar", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Usabilidad de cada proveedor por tarea: integrados según key presente; propios
  // según enabled + conexión verificada + modelos marcados (o modelo legado).
  const customUsable = (p) => !!p.enabled && p.last_ok !== false;
  const customHasModel = (p, task) => {
    const marked = task === "ajustes" ? p.ajustes_models : p.seleccion_models;
    return (marked?.length > 0) || !!p.model;
  };
  const usable = (val, task) => {
    if (val === "base44") return task !== "ajustes";
    if (val === "none") return task !== "ajustes";
    if (val === "qwen") return keys.qwen;
    if (val === "gemini") return keys.gemini;
    if (val === "nvidia") return keys.nvidia;
    if (val.startsWith("custom:")) {
      const p = providers.find((c) => `custom:${c.id}` === val);
      return !!p && customUsable(p) && customHasModel(p, task);
    }
    return false;
  };
  const optionLabel = (suffix, val, task) => (usable(val, task) ? "" : suffix);

  const customOptions = providers.map((p) => ({ value: `custom:${p.id}`, label: p.name }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-accent" /> Proveedores IA
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Una sola herramienta para añadir proveedores de IA. La app muestra todos los modelos que funcionan y tú marcas
          cuáles usar para Selección IA y Ajustes IA (ajustes básicos).
        </p>
      </div>

      <AddProviderForm onAdd={addProvider} adding={adding} result={addResult} />

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold">Proveedores propios</p>
          {providers.length === 0 && (
            <span className="text-xs text-muted-foreground">— todavía no hay ninguno. Añade el primero arriba.</span>
          )}
        </div>
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            busyAction={busyAction}
            onSaveModels={saveModels}
            onRetest={retestProvider}
            onToggle={toggleProvider}
            onDelete={deleteProvider}
          />
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold">Proveedores integrados</p>
        </div>
        <IntegratedProviderCard
          title="Google Gemini"
          keyPresent={keys.gemini}
          endpointValue={form.gemini_endpoint}
          endpointPlaceholder="https://generativelanguage.googleapis.com/v1beta"
          endpointHint="URL base de la API Gemini (sin /models/...)."
          modelValue={form.gemini_model}
          modelPlaceholder="gemini-2.5-flash"
          modelHint="Único modelo admitido: gemini-2.5-flash."
          enabled={form.gemini_enabled}
          enabledLabel="Gemini habilitado"
          onEndpoint={(v) => setForm((f) => ({ ...f, gemini_endpoint: v }))}
          onModel={(v) => setForm((f) => ({ ...f, gemini_model: v }))}
          onEnabled={(v) => setForm((f) => ({ ...f, gemini_enabled: v }))}
          onTest={() => testIntegrated("gemini")}
          testing={testing.gemini}
          result={results.gemini}
          note="Las previews van como data:image/jpeg;base64 directo a la API de Gemini, sin UploadFile ni InvokeLLM. Sin failover."
        />
        <IntegratedProviderCard
          title="Qwen — DashScope"
          keyPresent={keys.qwen}
          endpointValue={form.qwen_endpoint}
          endpointPlaceholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
          endpointHint="URL base OpenAI-compatible de DashScope (sin /chat/completions)."
          modelValue={form.qwen_model}
          modelPlaceholder="qwen3-vl-plus"
          modelHint="Modelo multimodal de Qwen (ej. qwen3-vl-plus, qwen-vl-max)."
          enabled={form.qwen_enabled}
          enabledLabel="Qwen habilitado"
          onEndpoint={(v) => setForm((f) => ({ ...f, qwen_endpoint: v }))}
          onModel={(v) => setForm((f) => ({ ...f, qwen_model: v }))}
          onEnabled={(v) => setForm((f) => ({ ...f, qwen_enabled: v }))}
          onTest={() => testIntegrated("qwen")}
          testing={testing.qwen}
          result={results.qwen}
        />
        <IntegratedProviderCard
          title="NVIDIA NIM"
          icon={Cpu}
          keyPresent={keys.nvidia}
          endpointValue={form.nvidia_endpoint}
          endpointPlaceholder="https://integrate.api.nvidia.com/v1"
          endpointHint="URL base OpenAI-compatible de NVIDIA NIM (sin /chat/completions)."
          modelValue={form.nvidia_model}
          modelPlaceholder="minimaxai/minimax-m3"
          modelHint="VLM multimodal de NVIDIA NIM (ej. minimaxai/minimax-m3)."
          enabled={form.nvidia_enabled}
          enabledLabel="NVIDIA habilitado (experimental)"
          onEndpoint={(v) => setForm((f) => ({ ...f, nvidia_endpoint: v }))}
          onModel={(v) => setForm((f) => ({ ...f, nvidia_model: v }))}
          onEnabled={(v) => setForm((f) => ({ ...f, nvidia_enabled: v }))}
          onTest={() => testIntegrated("nvidia")}
          testing={testing.nvidia}
          result={results.nvidia}
          note="La ruta NVIDIA envía previews como data:image/jpeg;base64 directo, sin UploadFile ni InvokeLLM. Sin failover."
        />
      </section>

      {/* Proveedor activo por herramienta */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Proveedor activo por herramienta</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Selección IA</label>
          <select value={form.active_seleccion} onChange={(e) => setForm((f) => ({ ...f, active_seleccion: e.target.value }))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="base44">Base44 (InvokeLLM)</option>
            <option value="gemini" disabled={!usable("gemini", "seleccion")}>Gemini{optionLabel(" — apagado", "gemini", "seleccion")}</option>
            <option value="qwen" disabled={!usable("qwen", "seleccion")}>Qwen{optionLabel(" — apagado", "qwen", "seleccion")}</option>
            <option value="nvidia" disabled={!usable("nvidia", "seleccion")}>NVIDIA{optionLabel(" — apagado", "nvidia", "seleccion")}</option>
            {customOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={!usable(o.value, "seleccion")}>
                {o.label}{optionLabel(" — sin modelos marcados", o.value, "seleccion")}
              </option>
            ))}
            <option value="none">Ninguno</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ajustes IA</label>
          <select value={form.active_ajustes} onChange={(e) => setForm((f) => ({ ...f, active_ajustes: e.target.value }))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="gemini" disabled={!usable("gemini", "ajustes")}>Gemini{optionLabel(" — apagado", "gemini", "ajustes")}</option>
            <option value="qwen" disabled={!usable("qwen", "ajustes")}>Qwen{optionLabel(" — apagado", "qwen", "ajustes")}</option>
            <option value="nvidia" disabled={!usable("nvidia", "ajustes")}>NVIDIA{optionLabel(" — apagado", "nvidia", "ajustes")}</option>
            {customOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={!usable(o.value, "ajustes")}>
                {o.label}{optionLabel(" — sin modelos marcados", o.value, "ajustes")}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Para Ajustes IA (Revelado Visual e Híbrido) sirven Qwen, NVIDIA, Gemini y tus proveedores propios con modelos
            marcados. Los proveedores propios usan el mejor modelo marcado para cada tarea.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          En Selección hay failover: si el proveedor activo falla, se reintenta con el siguiente habilitado. En Ajustes,
          el proveedor activo es el único responsable.
        </p>
      </div>

      <div className="flex gap-3">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
        </button>
      </div>
    </div>
  );
}