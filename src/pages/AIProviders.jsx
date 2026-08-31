import { useEffect, useState } from "react";
import { KeyRound, Loader2, CheckCircle2, XCircle, Save, Upload, Cpu, Plus, Trash2, Power, RefreshCw, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { isRawFile, extractRawPreview } from "@/lib/rawaistudio/rawPreviewReader";

// Proveedores IA — admin. Los proveedores integrados (Qwen, NVIDIA, Gemini) usan API Keys
// gestionadas como secrets de Base44. Los modelos personalizados se añaden AQUI con su
// URL + API key + modelo y se almacenan en la entidad CustomAiProvider (admin-only). Al
// comprobarse correctamente, aparecen como opcion en "Proveedor activo" para Seleccion y
// Ajustes, y se enrutan como proveedores OpenAI-compatible (mismo contrato que Qwen).
export default function AIProviders() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qwenKeyPresent, setQwenKeyPresent] = useState(false);
  const [nvidiaKeyPresent, setNvidiaKeyPresent] = useState(false);
  const [geminiKeyPresent, setGeminiKeyPresent] = useState(false);
  const [form, setForm] = useState({
    qwen_enabled: false,
    qwen_endpoint: "",
    qwen_model: "qwen3-vl-plus",
    nvidia_enabled: false,
    nvidia_endpoint: "https://integrate.api.nvidia.com/v1",
    nvidia_model: "minimaxai/minimax-m3",
    gemini_enabled: false,
    gemini_endpoint: "https://generativelanguage.googleapis.com/v1beta",
    gemini_model: "gemini-3.6-flash",
    active_seleccion: "base44",
    active_ajustes: "base44",
  });

  const [testingQwen, setTestingQwen] = useState(false);
  const [qwenResult, setQwenResult] = useState(null);
  const [testingNvidia, setTestingNvidia] = useState(false);
  const [nvidiaResult, setNvidiaResult] = useState(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiResult, setGeminiResult] = useState(null);
  const [visionFile, setVisionFile] = useState(null);
  const [testingVision, setTestingVision] = useState(false);
  const [visionResult, setVisionResult] = useState(null);

  // Modelos personalizados
  const [customProviders, setCustomProviders] = useState([]);
  const [newModel, setNewModel] = useState({ name: "", endpoint: "", model: "", api_key: "" });
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [retestingId, setRetestingId] = useState(null);
  const [detecting, setDetecting] = useState(false);

  const loadCustom = async () => {
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "list-custom" });
      const data = res?.data ?? res;
      setCustomProviders(Array.isArray(data?.providers) ? data.providers : []);
    } catch {
      setCustomProviders([]);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "get-config" });
      const data = res?.data ?? res;
      setQwenKeyPresent(!!data.qwen_key_present);
      setNvidiaKeyPresent(!!data.nvidia_key_present);
      setGeminiKeyPresent(!!data.gemini_key_present);
      if (data.config) {
        setForm({
          qwen_enabled: !!data.config.qwen_enabled,
          qwen_endpoint: data.config.qwen_endpoint || "",
          qwen_model: data.config.qwen_model || "qwen3-vl-plus",
          nvidia_enabled: data.config.nvidia_enabled !== false,
          nvidia_endpoint: data.config.nvidia_endpoint || "https://integrate.api.nvidia.com/v1",
          nvidia_model: data.config.nvidia_model || "minimaxai/minimax-m3",
          gemini_enabled: data.config.gemini_enabled !== false,
          gemini_endpoint: data.config.gemini_endpoint || "https://generativelanguage.googleapis.com/v1beta",
          gemini_model: data.config.gemini_model || "gemini-3.6-flash",
          active_seleccion: data.config.active_seleccion || "base44",
          active_ajustes: data.config.active_ajustes || "base44",
        });
      }
      await loadCustom();
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
      setGeminiKeyPresent(!!data.gemini_key_present);
      toast({ title: "Configuración guardada" });
    } catch (e) {
      toast({ title: "Error al guardar", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const testQwen = async () => {
    setTestingQwen(true); setQwenResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection", provider: "qwen" });
      setQwenResult(res?.data ?? res);
    } catch (e) { setQwenResult({ ok: false, reason: e.message }); }
    setTestingQwen(false);
  };

  const testNvidia = async () => {
    setTestingNvidia(true); setNvidiaResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection", provider: "nvidia" });
      setNvidiaResult(res?.data ?? res);
    } catch (e) { setNvidiaResult({ ok: false, reason: e.message }); }
    setTestingNvidia(false);
  };

  const testGemini = async () => {
    setTestingGemini(true); setGeminiResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "test-connection", provider: "gemini" });
      setGeminiResult(res?.data ?? res);
    } catch (e) { setGeminiResult({ ok: false, reason: e.message }); }
    setTestingGemini(false);
  };

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
    setTestingVision(true); setVisionResult(null);
    try {
      let previewBase64;
      if (isRawFile(visionFile.name)) {
        const prev = await extractRawPreview(visionFile, 800);
        previewBase64 = prev?.base64;
        if (!previewBase64) throw new Error("No se pudo extraer la preview del RAW");
      } else {
        previewBase64 = await fileToBase64(visionFile);
      }
      const res = await base44.functions.invoke("ai-providers", { action: "test-nvidia-vision", preview_base64: previewBase64 });
      setVisionResult(res?.data ?? res);
    } catch (e) { setVisionResult({ ok: false, reason: e.message }); }
    setTestingVision(false);
  };

  // Añadir modelo personalizado: comprueba la conexion con las credenciales introducidas
  // y, si todo ok, lo guarda. Si falla, no se guarda y se muestra el motivo.
  const addCustom = async () => {
    if (!newModel.name.trim() || !newModel.endpoint.trim() || !newModel.api_key.trim()) {
      setAddResult({ ok: false, reason: "Completa nombre, endpoint y API key" });
      return;
    }
    setAdding(true); setAddResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "add-custom", ...newModel });
      const data = res?.data ?? res;
      if (data.ok) {
        toast({ title: "Modelo añadido", description: `${newModel.name} verificado y guardado` });
        setNewModel({ name: "", endpoint: "", model: "", api_key: "" });
        await loadCustom();
      } else {
        setAddResult({ ok: false, reason: data.reason || "No se pudo verificar" });
      }
    } catch (e) {
      setAddResult({ ok: false, reason: e.message });
    }
    setAdding(false);
  };

  const retestCustom = async (id) => {
    setRetestingId(id);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "retest-custom", id });
      const data = res?.data ?? res;
      await loadCustom();
      toast({ title: data.ok ? "Conexión correcta" : "Falló la conexión", description: data.ok ? undefined : data.reason, variant: data.ok ? "default" : "destructive" });
    } catch (e) {
      toast({ title: "Falló la conexión", description: e.message, variant: "destructive" });
    }
    setRetestingId(null);
  };

  const toggleCustom = async (id, enabled) => {
    try {
      await base44.functions.invoke("ai-providers", { action: "toggle-custom", id, enabled });
      await loadCustom();
    } catch (e) {
      toast({ title: "No se pudo cambiar", description: e.message, variant: "destructive" });
    }
  };

  const deleteCustom = async (id, name) => {
    if (!window.confirm(`¿Eliminar el modelo "${name}"? Si está activo en Selección o Ajustes, vuelve a Base44.`)) return;
    try {
      await base44.functions.invoke("ai-providers", { action: "delete-custom", id });
      // Si estaba seleccionado, revertir a base44
      setForm((f) => ({
        ...f,
        active_seleccion: f.active_seleccion === `custom:${id}` ? "base44" : f.active_seleccion,
        active_ajustes: f.active_ajustes === `custom:${id}` ? "base44" : f.active_ajustes,
      }));
      await loadCustom();
      toast({ title: "Modelo eliminado" });
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" });
    }
  };

  // Detecta el mejor modelo de vision del proveedor consultando su endpoint /models.
  // Rellena el campo "Modelo" del formulario con el detectado.
  const detectModel = async () => {
    if (!newModel.endpoint.trim() || !newModel.api_key.trim()) {
      setAddResult({ ok: false, reason: "Introduce endpoint y API key para detectar el modelo" });
      return;
    }
    setDetecting(true); setAddResult(null);
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "detect-model", endpoint: newModel.endpoint, api_key: newModel.api_key });
      const data = res?.data ?? res;
      if (data.ok) {
        setNewModel((m) => ({ ...m, model: data.model }));
        toast({ title: "Modelo detectado", description: `${data.model} (${data.total} modelos disponibles)` });
      } else {
        setAddResult({ ok: false, reason: data.reason || "No se pudo detectar" });
      }
    } catch (e) {
      setAddResult({ ok: false, reason: e.message });
    }
    setDetecting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const customOptions = customProviders.map((p) => ({ value: `custom:${p.id}`, label: p.name }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-accent" /> Proveedores IA
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura los proveedores de IA para Selección y Ajustes. Los proveedores integrados (Qwen, NVIDIA, Gemini) usan API Keys como secrets de Base44. Los modelos personalizados se añaden aquí con su URL y API key.
        </p>
      </div>

      <KeyBadge present={qwenKeyPresent} name="Qwen (QWEN_API_KEY)" />
      <KeyBadge present={nvidiaKeyPresent} name="NVIDIA (NVIDIA_API_KEY)" />
      <KeyBadge present={geminiKeyPresent} name="Gemini (GEMINI_API_KEY)" />

      {/* Añadir modelo personalizado */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold">Añadir modelo IA</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Introduce la URL base (OpenAI-compatible, sin /chat/completions), el modelo de visión, la API key y pulsa Comprobar. Si la conexión es correcta, se guarda y aparece como proveedor activo seleccionable.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nombre</label>
            <input value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
              placeholder="Mi proveedor" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Modelo <span className="text-muted-foreground font-normal">(opcional)</span></label>
            <div className="flex gap-2">
              <input value={newModel.model} onChange={(e) => setNewModel({ ...newModel, model: e.target.value })}
                placeholder="Auto — la app detecta el mejor" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <button onClick={detectModel} disabled={detecting || !newModel.endpoint || !newModel.api_key}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-40">
                {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Detectar
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Si lo dejas vacío, la app consulta el proveedor y elige el mejor modelo de visión disponible (proveedores con miles de modelos).</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Endpoint base</label>
          <input value={newModel.endpoint} onChange={(e) => setNewModel({ ...newModel, endpoint: e.target.value })}
            placeholder="https://api.openai.com/v1" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">API key</label>
          <input type="password" value={newModel.api_key} onChange={(e) => setNewModel({ ...newModel, api_key: e.target.value })}
            placeholder="sk-…" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </div>
        <button onClick={addCustom} disabled={adding}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Comprobar y guardar
        </button>
        {addResult && (
          <div className={`rounded-lg border p-3 text-xs ${addResult.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-red-300 bg-red-50 text-red-700"}`}>
            {addResult.ok ? "Conexión correcta. Modelo guardado." : `No se pudo verificar: ${addResult.reason}`}
          </div>
        )}

        {/* Lista de modelos personalizados */}
        {customProviders.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-sm font-medium">Modelos añadidos</p>
            {customProviders.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    {p.last_ok
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" /> OK</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"><XCircle className="h-3 w-3" /> Error</span>}
                    {!p.enabled && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">Deshabilitado</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.model} · {p.endpoint}</p>
                  {p.last_reason && <p className="mt-0.5 truncate text-xs text-red-500">{p.last_reason}</p>}
                </div>
                <button onClick={() => retestCustom(p.id)} disabled={retestingId === p.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40">
                  {retestingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Comprobar
                </button>
                <button onClick={() => toggleCustom(p.id, !p.enabled)} title={p.enabled ? "Deshabilitar" : "Habilitar"}
                  className="inline-flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary">
                  <Power className={`h-3.5 w-3.5 ${p.enabled ? "text-emerald-600" : "text-muted-foreground"}`} />
                </button>
                <button onClick={() => deleteCustom(p.id, p.name)} title="Eliminar"
                  className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-destructive hover:bg-destructive/5">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Qwen */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Qwen — DashScope (OpenAI-compatible)</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Endpoint base</label>
          <input value={form.qwen_endpoint} onChange={(e) => setForm({ ...form, qwen_endpoint: e.target.value })}
            placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-xs text-muted-foreground">URL base OpenAI-compatible de DashScope (sin /chat/completions).</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Modelo de visión</label>
          <input value={form.qwen_model} onChange={(e) => setForm({ ...form, qwen_model: e.target.value })}
            placeholder="qwen3-vl-plus" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
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
          <input value={form.nvidia_endpoint} onChange={(e) => setForm({ ...form, nvidia_endpoint: e.target.value })}
            placeholder="https://integrate.api.nvidia.com/v1" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-xs text-muted-foreground">URL base OpenAI-compatible de NVIDIA NIM (sin /chat/completions).</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Modelo de visión</label>
          <input value={form.nvidia_model} onChange={(e) => setForm({ ...form, nvidia_model: e.target.value })}
            placeholder="minimaxai/minimax-m3" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
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
          <input type="file" accept="image/jpeg,image/png,.cr3,.cr2,.nef,.arw,.raf,.rw2,.dng,.orf,.pef,.srw,.raw" onChange={(e) => setVisionFile(e.target.files?.[0] || null)}
            className="text-xs" />
          <button onClick={testVision} disabled={!visionFile || testingVision}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">
            {testingVision ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Probar 1 foto
          </button>
          {visionResult && <ResultCard result={visionResult} extraFields={["via_invoke_llm", "via_upload_file"]} showContentPreview />}
        </div>
      </div>

      {/* Gemini */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Google Gemini (generativelanguage)</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Endpoint base</label>
          <input value={form.gemini_endpoint} onChange={(e) => setForm({ ...form, gemini_endpoint: e.target.value })}
            placeholder="https://generativelanguage.googleapis.com/v1beta" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-xs text-muted-foreground">URL base de la API Gemini (sin /models/...).</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Modelo de visión</label>
          <input value={form.gemini_model} onChange={(e) => setForm({ ...form, gemini_model: e.target.value })}
            placeholder="gemini-3.6-flash" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <p className="text-xs text-muted-foreground">Modelo multimodal de Gemini (ej. gemini-3.6-flash, gemini-2.5-flash).</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.gemini_enabled} onChange={(e) => setForm({ ...form, gemini_enabled: e.target.checked })} />
          Gemini habilitado
        </label>
        <p className="text-xs text-muted-foreground">
          La ruta Gemini envía previews como data:image/jpeg;base64 directamente a la API de Gemini, sin usar UploadFile ni InvokeLLM de Base44. Sin failover.
        </p>
        <div className="flex gap-3">
          <button onClick={testGemini} disabled={testingGemini}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40">
            {testingGemini ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Probar conexión Gemini
          </button>
        </div>
        {geminiResult && <ResultCard result={geminiResult} />}
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
            <option value="gemini">Gemini</option>
            <option value="nvidia">NVIDIA MiniMax M3</option>
            {customOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="none">Ninguno</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ajustes IA</label>
          <select value={form.active_ajustes} onChange={(e) => setForm({ ...form, active_ajustes: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="base44">Base44 (InvokeLLM)</option>
            <option value="qwen">Qwen</option>
            <option value="gemini">Gemini</option>
            <option value="nvidia">NVIDIA MiniMax M3</option>
            {customOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="none">Ninguno</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Los modelos personalizados se usan como proveedores OpenAI-compatible de visión: reciben los mismos prompts y esquemas que Qwen tanto en Selección como en Ajustes, así saben qué hacer en cada herramienta. <span className="font-medium text-foreground">Failover activo:</span> si el proveedor seleccionado falla, la app reintenta automáticamente con el siguiente proveedor habilitado (no se detiene el proceso).
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