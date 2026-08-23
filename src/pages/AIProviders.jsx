import { useEffect, useState } from "react";
import { KeyRound, Loader2, CheckCircle2, XCircle, Save, Upload, Cpu } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

// Proveedores IA — admin. Configura proveedor/endpoint/modelo y el activo por herramienta.
// Las API Keys NO se introducen aqui: viven como secrets de Base44 (QWEN_API_KEY,
// NVIDIA_API_KEY). Esta pagina solo muestra si estan presentes (badge) y permite probar
// la conexion (ping + prueba de vision con 1 preview base64 para NVIDIA).
export default function AIProviders() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qwenKeyPresent, setQwenKeyPresent] = useState(false);
  const [nvidiaKeyPresent, setNvidiaKeyPresent] = useState(false);
  const [form, setForm] = useState({
    qwen_enabled: false,
    qwen_endpoint: "",
    qwen_model: "qwen3-vl-plus",
    nvidia_enabled: false,
    nvidia_endpoint: "https://integrate.api.nvidia.com/v1",
    nvidia_model: "minimaxai/minimax-m3",
    active_seleccion: "base44",
    active_ajustes: "base44",
  });

  const [testingQwen, setTestingQwen] = useState(false);
  const [qwenResult, setQwenResult] = useState(null);
  const [testingNvidia, setTestingNvidia] = useState(false);
  const [nvidiaResult, setNvidiaResult] = useState(null);
  const [visionFile, setVisionFile] = useState(null);
  const [testingVision, setTestingVision] = useState(false);
  const [visionResult, setVisionResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "get-config" });
      const data = res?.data ?? res;
      setQwenKeyPresent(!!data.qwen_key_present);
      setNvidiaKeyPresent(!!data.nvidia_key_present);
      if (data.config) {
        setForm({
          qwen_enabled: !!data.config.qwen_enabled,
          qwen_endpoint: data.config.qwen_endpoint || "",
          qwen_model: data.config.qwen_model || "qwen3-vl-plus",
          nvidia_enabled: data.config.nvidia_enabled !== false,
          nvidia_endpoint: data.config.nvidia_endpoint || "https://integrate.api.nvidia.com/v1",
          nvidia_model: data.config.nvidia_model || "minimaxai/minimax-m3",
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
      setQwenKeyPresent(!!data.qwen_key_present);
      setNvidiaKeyPresent(!!data.nvidia_key_present);
      toast({ title: "Configuración guardada" });
    } catch (e) {
      toast({ title: "Error al guardar", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const testQwen = async () => {
    setTestingQwen(true);
    setQwenResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection", provider: "qwen" });
      setQwenResult(res?.data ?? res);
    } catch (e) {
      setQwenResult({ ok: false, reason: e.message });
    }
    setTestingQwen(false);
  };

  const testNvidia = async () => {
    setTestingNvidia(true);
    setNvidiaResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection", provider: "nvidia" });
      setNvidiaResult(res?.data ?? res);
    } catch (e) {
      setNvidiaResult({ ok: false, reason: e.message });
    }
    setTestingNvidia(false);
  };

  // Lee un File como base64 puro (sin prefijo data:) para enviarlo a test-nvidia-vision.
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const testVision = async () => {
    if (!visionFile) return;
    setTestingVision(true);
    setVisionResult(null);
    try {
      const previewBase64 = await fileToBase64(visionFile);
      const res = await base44.functions.invoke("ai-providers", { action: "test-nvidia-vision", preview_base64: previewBase64 });
      setVisionResult(res?.data ?? res);
    } catch (e) {
      setVisionResult({ ok: false, reason: e.message });
    }
    setTestingVision(false);
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
          Configura el proveedor de IA para Selección y Ajustes IA. Las API Keys se gestionan como secrets de Base44, nunca en esta página.
        </p>
      </div>

      <KeyBadge present={qwenKeyPresent} name="Qwen (QWEN_API_KEY)" />
      <KeyBadge present={nvidiaKeyPresent} name="NVIDIA (NVIDIA_API_KEY)" />

      {/* Qwen */}
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
          <input type="checkbox" checked={form.qwen_enabled} onChange={(e) => setForm({ ...form, qwen_enabled: e.target.checked })} />
          Qwen habilitado
        </label>
        <div className="flex gap-3">
          <button onClick={testQwen} disabled={testingQwen}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">
            {testingQwen ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Probar conexión Qwen
          </button>
        </div>
        {qwenResult && <ResultCard result={qwenResult} />}
      </div>

      {/* NVIDIA */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold">NVIDIA NIM — MiniMax M3 (experimental)</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Endpoint base</label>
          <input
            value={form.nvidia_endpoint}
            onChange={(e) => setForm({ ...form, nvidia_endpoint: e.target.value })}
            placeholder="https://integrate.api.nvidia.com/v1"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">URL base OpenAI-compatible de NVIDIA NIM (sin /chat/completions).</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Modelo de visión</label>
          <input
            value={form.nvidia_model}
            onChange={(e) => setForm({ ...form, nvidia_model: e.target.value })}
            placeholder="minimaxai/minimax-m3"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">VLM multimodal de NVIDIA NIM (ej. minimaxai/minimax-m3).</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.nvidia_enabled} onChange={(e) => setForm({ ...form, nvidia_enabled: e.target.checked })} />
          NVIDIA habilitado (experimental)
        </label>
        <p className="text-xs text-muted-foreground">
          La ruta NVIDIA envía previews como data:image/jpeg;base64 directamente al endpoint, sin usar UploadFile ni InvokeLLM de Base44. Sin failover.
        </p>
        <div className="flex flex-wrap gap-3">
          <button onClick={testNvidia} disabled={testingNvidia}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">
            {testingNvidia ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Probar conexión NVIDIA
          </button>
        </div>
        {nvidiaResult && <ResultCard result={nvidiaResult} extraFields={["via_invoke_llm"]} />}

        <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
          <p className="text-sm font-medium">Prueba de visión con 1 foto (base64 directo)</p>
          <p className="text-xs text-muted-foreground">
            Sube una imagen (JPEG). Se envía como data URL directa a NVIDIA, sin UploadFile ni InvokeLLM.
          </p>
          <input type="file" accept="image/jpeg,image/png" onChange={(e) => setVisionFile(e.target.files?.[0] || null)}
            className="text-xs" />
          <button onClick={testVision} disabled={!visionFile || testingVision}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">
            {testingVision ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Probar 1 foto
          </button>
          {visionResult && <ResultCard result={visionResult} extraFields={["via_invoke_llm", "via_upload_file"]} showContentPreview />}
        </div>
      </div>

      {/* Proveedor activo por herramienta */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Proveedor activo por herramienta</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Selección IA</label>
          <select value={form.active_seleccion} onChange={(e) => setForm({ ...form, active_seleccion: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="base44">Base44 (InvokeLLM)</option>
            <option value="qwen">Qwen</option>
            <option value="nvidia">NVIDIA MiniMax M3</option>
            <option value="none">Ninguno</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ajustes IA</label>
          <select value={form.active_ajustes} onChange={(e) => setForm({ ...form, active_ajustes: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="base44">Base44 (InvokeLLM)</option>
            <option value="qwen">Qwen</option>
            <option value="nvidia">NVIDIA MiniMax M3</option>
            <option value="none">Ninguno</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Sin failover: si el proveedor activo falla, se devuelve error (no se consume InvokeLLM ni se cambia de proveedor). El proveedor por defecto sigue siendo Base44.
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

function KeyBadge({ present, name }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      {present ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-red-500" />}
      <div>
        <p className="text-sm font-medium">Clave {name}</p>
        <p className="text-xs text-muted-foreground">
          {present ? "Configurada en Base44 → Secrets." : "No configurada. Introdúcela en Base44 → Settings → Secrets."}
        </p>
      </div>
    </div>
  );
}

function ResultCard({ result, extraFields = [], showContentPreview = false }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2 text-sm">
      <p className="font-semibold">Resultado</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Field label="provider" value={result.provider} />
        <Field label="ok" value={String(result.ok)} />
        <Field label="model" value={result.model} />
        <Field label="endpoint" value={result.endpoint} />
        <Field label="http_status" value={result.http_status != null ? String(result.http_status) : "—"} />
        <Field label="latency_ms" value={result.latency_ms != null ? String(result.latency_ms) : "—"} />
        <Field label="key_present" value={String(result.key_present)} />
        <Field label="via_invoke_llm" value={String(result.via_invoke_llm)} />
        {extraFields.includes("via_upload_file") && <Field label="via_upload_file" value={String(result.via_upload_file)} />}
      </div>
      {result.reason && <p className="text-red-500 text-xs">Razón: {result.reason}</p>}
      {showContentPreview && result.content_preview != null && (
        <p className="text-xs text-muted-foreground break-all">Contenido: {result.content_preview || "—"}</p>
      )}
      {result.response_preview && (
        <p className="text-xs text-muted-foreground break-all">Respuesta: {result.response_preview}</p>
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