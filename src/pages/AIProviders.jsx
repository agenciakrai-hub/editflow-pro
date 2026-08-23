import { useEffect, useState } from "react";
import { KeyRound, Loader2, CheckCircle2, XCircle, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

// Proveedores IA — admin. Configura proveedor/endpoint/modelo y el activo por herramienta.
// La API Key NO se introduce aqui: vive como secret de Base44 (QWEN_API_KEY). Esta pagina
// solo muestra si esta presente (badge) y permite probar la conexion.
export default function AIProviders() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyPresent, setKeyPresent] = useState(false);
  const [form, setForm] = useState({
    qwen_enabled: false,
    qwen_endpoint: "",
    qwen_model: "qwen3-vl-plus",
    active_seleccion: "base44",
    active_ajustes: "base44",
  });
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "get-config" });
      const data = res?.data ?? res;
      setKeyPresent(!!data.qwen_key_present);
      if (data.config) {
        setForm({
          qwen_enabled: !!data.config.qwen_enabled,
          qwen_endpoint: data.config.qwen_endpoint || "",
          qwen_model: data.config.qwen_model || "qwen3-vl-plus",
          active_seleccion: data.config.active_seleccion || "base44",
          active_ajustes: data.config.active_ajustes || "base44",
        });
      }
    } catch (e) {
      toast({ title: "Error al cargar", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "save-config", ...form });
      const data = res?.data ?? res;
      setKeyPresent(!!data.qwen_key_present);
      toast({ title: "Configuración guardada" });
    } catch (e) {
      toast({ title: "Error al guardar", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection" });
      setTestResult(res?.data ?? res);
    } catch (e) {
      setTestResult({ ok: false, reason: e.message });
    }
    setTesting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-accent" /> Proveedores IA
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura el proveedor de IA para Selección y Ajustes IA. La API Key se gestiona como secret de Base44, nunca en esta página.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        {keyPresent ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-red-500" />}
        <div>
          <p className="text-sm font-medium">Clave Qwen (QWEN_API_KEY)</p>
          <p className="text-xs text-muted-foreground">
            {keyPresent
              ? "Configurada en Base44 → Secrets."
              : "No configurada. Introdúcela en Base44 → Settings → Secrets como QWEN_API_KEY."}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Qwen — DashScope (OpenAI-compatible)</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Endpoint base</label>
          <input
            value={form.qwen_endpoint}
            onChange={(e) => setForm({ ...form, qwen_endpoint: e.target.value })}
            placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">URL base OpenAI-compatible de DashScope (sin /chat/completions).</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Modelo de visión</label>
          <input
            value={form.qwen_model}
            onChange={(e) => setForm({ ...form, qwen_model: e.target.value })}
            placeholder="qwen3-vl-plus"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">Debe admitir entrada multimodal de imágenes (ej. qwen3-vl-plus, qwen-vl-max).</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.qwen_enabled}
            onChange={(e) => setForm({ ...form, qwen_enabled: e.target.checked })}
          />
          Qwen habilitado
        </label>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Proveedor activo por herramienta</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Selección IA</label>
          <select
            value={form.active_seleccion}
            onChange={(e) => setForm({ ...form, active_seleccion: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="base44">Base44 (InvokeLLM)</option>
            <option value="qwen">Qwen</option>
            <option value="none">Ninguno</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ajustes IA</label>
          <select
            value={form.active_ajustes}
            onChange={(e) => setForm({ ...form, active_ajustes: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="base44">Base44 (InvokeLLM)</option>
            <option value="qwen">Qwen</option>
            <option value="none">Ninguno</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Sin failover: si el proveedor activo falla, se devuelve error (no se consume InvokeLLM).
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Probar conexión Qwen
        </button>
      </div>

      {testResult && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-2 text-sm">
          <p className="font-semibold">Resultado de la prueba</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Field label="provider" value={testResult.provider} />
            <Field label="ok" value={String(testResult.ok)} />
            <Field label="model" value={testResult.model} />
            <Field label="endpoint" value={testResult.endpoint} />
            <Field label="http_status" value={testResult.http_status != null ? String(testResult.http_status) : "—"} />
            <Field label="latency_ms" value={testResult.latency_ms != null ? String(testResult.latency_ms) : "—"} />
            <Field label="key_present" value={String(testResult.key_present)} />
            <Field label="via_invoke_llm" value={String(testResult.via_invoke_llm)} />
          </div>
          {testResult.reason && <p className="text-red-500 text-xs">Razón: {testResult.reason}</p>}
          {testResult.response_preview && (
            <p className="text-xs text-muted-foreground break-all">Respuesta: {testResult.response_preview}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono">{value || "—"}</p>
    </div>
  );
}