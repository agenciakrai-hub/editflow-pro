import { useEffect, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import AddProviderForm from "@/components/aiProviders/AddProviderForm";
import ProviderCard from "@/components/aiProviders/ProviderCard";
import NvidiaVisionTest from "@/components/aiProviders/NvidiaVisionTest";

// Proveedores IA — UNA sola lista unificada. Los antiguos proveedores integrados
// (Gemini, Qwen, NVIDIA) se migran a la misma base de datos que los propios: todos los
// proveedores muestran sus modelos marcables por tarea (Selección IA / Ajustes IA),
// permiten cambiar la API key, encenderse/apagarse y eliminarse de la base de datos.
export default function AIProviders() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState([]);
  const [active, setActive] = useState({ active_seleccion: "base44", active_ajustes: "", active_model_seleccion: "", active_model_ajustes: "", active_album: "", active_model_album: "" });
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [busyAction, setBusyAction] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const resList = await base44.functions.invoke("ai-providers", { action: "list" });
      const dataList = resList?.data ?? resList;
      setProviders(Array.isArray(dataList?.providers) ? dataList.providers : []);
      const res = await base44.functions.invoke("ai-providers", { action: "get-config" });
      const data = res?.data ?? res;
      const cfg = data?.config;
      setActive({
        active_seleccion: cfg?.active_seleccion || "base44",
        active_ajustes: cfg?.active_ajustes || "",
        active_model_seleccion: cfg?.active_model_seleccion || "",
        active_model_ajustes: cfg?.active_model_ajustes || "",
        active_album: cfg?.active_album || "",
        active_model_album: cfg?.active_model_album || "",
      });
    } catch (e) {
      toast({ title: "Error al cargar", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ---- Proveedores ----
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

  const saveModels = async (id, seleccion_models, ajustes_models, edicion_models, video_models, album_models) => {
    setBusyAction({ id, action: "save" });
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "update-models", id, seleccion_models, ajustes_models, edicion_models, video_models, album_models });
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

  const retestProvider = async (id, force = false) => {
    setBusyAction({ id, action: force ? "reclassify" : "retest" });
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "retest", id, force });
      const data = res?.data ?? res;
      if (data.provider) setProviders((prev) => prev.map((p) => (p.id === id ? data.provider : p)));
      toast({
        title: data.ok ? (force ? "Reclasificación completa" : "Re-test completo") : "Falló la conexión",
        description: data.ok ? `${data.total_models} modelos — capacidades clasificadas automáticamente` : data.reason,
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
    if (!window.confirm(`¿Eliminar el proveedor "${name}"? Se borrará de la base de datos.`)) return;
    try {
      await base44.functions.invoke("ai-providers", { action: "delete", id });
      setProviders((prev) => prev.filter((p) => p.id !== id));
      setActive((a) => ({
        active_seleccion: a.active_seleccion === `custom:${id}` ? "base44" : a.active_seleccion,
        active_ajustes: a.active_ajustes === `custom:${id}` ? "" : a.active_ajustes,
        active_model_seleccion: a.active_seleccion === `custom:${id}` ? "" : a.active_model_seleccion,
        active_model_ajustes: a.active_ajustes === `custom:${id}` ? "" : a.active_model_ajustes,
        active_album: a.active_album === `custom:${id}` ? "" : a.active_album,
        active_model_album: a.active_album === `custom:${id}` ? "" : a.active_model_album,
      }));
      toast({ title: "Proveedor eliminado" });
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" });
    }
  };

  const updateKey = async (id, api_key) => {
    setBusyAction({ id, action: "key" });
    let ok = false;
    try {
      const res = await base44.functions.invoke("ai-providers", { action: "update-key", id, api_key });
      const data = res?.data ?? res;
      if (data.ok) {
        setProviders((prev) => prev.map((p) => (p.id === id ? data.provider : p)));
        toast({ title: "API key actualizada", description: `${data.total_models} modelos disponibles.` });
        ok = true;
      } else {
        toast({ title: "No se pudo actualizar la clave", description: data.reason, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "No se pudo actualizar la clave", description: e.message, variant: "destructive" });
    }
    setBusyAction(null);
    return ok;
  };

  const save = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke("ai-providers", { action: "save-active", ...active });
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

  // Usabilidad de un proveedor para una tarea: encendido, conexión verificada y con
  // modelos marcados (o modelo legado como fallback).
  const usable = (val, task) => {
    if (task === "album") {
      // Álbum: proveedores de la cadena propia (siempre utilizables) o propios con
      // modelos marcados para Álbum (o modelo legado como fallback).
      if (["gemini_paid", "qwen", "nvidia"].includes(val)) return true;
      if (!String(val || "").startsWith("custom:")) return false;
      const p = providers.find((c) => `custom:${c.id}` === val);
      if (!p || !p.enabled || p.last_ok === false) return false;
      return (p.album_models?.length > 0) || !!p.model;
    }
    if (val === "base44" || val === "none") return task === "seleccion";
    if (!String(val || "").startsWith("custom:")) return false;
    const p = providers.find((c) => `custom:${c.id}` === val);
    if (!p || !p.enabled || p.last_ok === false) return false;
    // Sin heurística de nombre: un proveedor es utilizable para Selección/Ajustes solo
    // si tiene modelos marcados en el catálogo. La ejecución además exige vision=true.
    const marked = task === "ajustes" ? p.ajustes_models : p.seleccion_models;
    return marked?.length > 0;
  };
  const optionLabel = (suffix, val, task) => (usable(val, task) ? "" : suffix);
  const providerOptions = providers.map((p) => ({ value: `custom:${p.id}`, label: p.name }));
  const seleccionCovered = ["base44", "none", ...providerOptions.map((o) => o.value)].includes(active.active_seleccion);
  const ajustesCovered = providerOptions.some((o) => o.value === active.active_ajustes);
  // Modelos marcados del proveedor activo de cada tarea (para elegir el modelo EXACTO).
  // Se EXCLUYEN los verificados como NO compatibles (vision=false); se incluyen los
  // verificados compatibles (true) y los no verificados (null) para no romper configs
  // existentes sin probar.
  const markedModelsOf = (task) => {
    const val = task === "ajustes" ? active.active_ajustes : task === "album" ? active.active_album : active.active_seleccion;
    const p = providers.find((c) => `custom:${c.id}` === val);
    const marked = task === "ajustes" ? p?.ajustes_models : task === "album" ? p?.album_models : p?.seleccion_models;
    const capKey = task === "ajustes" || task === "album" || task === "seleccion" ? "vision" : null;
    const meta = new Map((p?.available_models_meta || []).map((e) => [e.id, e]));
    return (Array.isArray(marked) ? marked : []).filter((m) => {
      if (!capKey) return true;
      const v = meta.get(m)?.caps?.[capKey];
      return v !== false;
    });
  };
  const seleccionModelOptions = markedModelsOf("seleccion");
  const ajustesModelOptions = markedModelsOf("ajustes");
  const albumModelOptions = markedModelsOf("album");
  // Cambia el proveedor activo de una tarea y LIMPIA el modelo exacto si deja de
  // pertenecer a la lista marcada del nuevo proveedor.
  const setTaskProvider = (task, value) => {
    setActive((a) => {
      const keys = {
        seleccion: ["active_seleccion", "active_model_seleccion"],
        ajustes: ["active_ajustes", "active_model_ajustes"],
        album: ["active_album", "active_model_album"],
      };
      const [providerKey, modelKey] = keys[task];
      const next = { ...a, [providerKey]: value };
      if (!String(value).startsWith("custom:")) {
        next[modelKey] = "";
      } else {
        const p = providers.find((c) => `custom:${c.id}` === value);
        const marked = task === "ajustes" ? p?.ajustes_models : task === "album" ? p?.album_models : p?.seleccion_models;
        if (!Array.isArray(marked) || !marked.includes(a[modelKey])) next[modelKey] = "";
      }
      return next;
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Proveedores IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Una sola lista de proveedores. Cada uno muestra todos sus modelos: marca cuáles usar para Selección IA,
          Ajustes IA y Álbum, cambia su API key, enciéndelo o apágalo, o elimínalo (se borra de la base de datos).
        </p>
      </div>

      <AddProviderForm onAdd={addProvider} adding={adding} result={addResult} />

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold">Proveedores</p>
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
            onUpdateKey={updateKey}
          />
        ))}
      </section>

      {/* Proveedor activo por herramienta */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-semibold">Proveedor activo por herramienta</p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Selección IA</label>
          <select value={active.active_seleccion} onChange={(e) => setTaskProvider("seleccion", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="base44">Base44 (InvokeLLM)</option>
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={!usable(o.value, "seleccion")}>
                {o.label}{optionLabel(" — apagado o sin modelos", o.value, "seleccion")}
              </option>
            ))}
            <option value="none">Ninguno</option>
            {!seleccionCovered && (
              <option value={active.active_seleccion}>Sin proveedor válido — elige uno</option>
            )}
          </select>
          {seleccionModelOptions.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <label className="text-sm font-medium">Modelo exacto para Selección IA</label>
              <select value={active.active_model_seleccion || ""} onChange={(e) => setActive((a) => ({ ...a, active_model_seleccion: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm">
                <option value="">Auto — mejor modelo marcado</option>
                {seleccionModelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ajustes IA</label>
          <select value={active.active_ajustes} onChange={(e) => setTaskProvider("ajustes", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">— elige un proveedor —</option>
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={!usable(o.value, "ajustes")}>
                {o.label}{optionLabel(" — apagado o sin modelos", o.value, "ajustes")}
              </option>
            ))}
            {!ajustesCovered && (
              <option value={active.active_ajustes}>Sin proveedor válido — elige uno</option>
            )}
          </select>
          {ajustesModelOptions.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <label className="text-sm font-medium">Modelo exacto para Ajustes IA</label>
              <select value={active.active_model_ajustes || ""} onChange={(e) => setActive((a) => ({ ...a, active_model_ajustes: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm">
                <option value="">Auto — mejor modelo marcado</option>
                {ajustesModelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">
                IA Visual y el modo Híbrido usan SIEMPRE este modelo exacto — sin heurística ni sustituciones. Con «Auto» se usa el mejor de los marcados.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Marca los modelos de cada proveedor y elige el modelo exacto de cada tarea. Sin modelo exacto se usa el mejor marcado.
          </p>
        </div>
        <div className="space-y-1.5 border-t border-border pt-4">
          <label className="text-sm font-medium">Álbum</label>
          <select value={active.active_album || ""} onChange={(e) => setTaskProvider("album", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Auto — cadena de Album AI (Gemini de pago → Qwen → NVIDIA)</option>
            <option value="gemini_paid">Google Gemini — Album AI (key de pago)</option>
            <option value="qwen">Qwen</option>
            <option value="nvidia">NVIDIA</option>
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={!usable(o.value, "album")}>
                {o.label}{optionLabel(" — apagado o sin modelos", o.value, "album")}
              </option>
            ))}
          </select>
          {active.active_album && (
            <div className="space-y-1.5 pt-1">
              <label className="text-sm font-medium">Modelo exacto para Álbum</label>
              {albumModelOptions.length > 0 ? (
                <select value={active.active_model_album || ""} onChange={(e) => setActive((a) => ({ ...a, active_model_album: e.target.value }))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm">
                  <option value="">Auto — mejor modelo marcado</option>
                  {albumModelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input value={active.active_model_album || ""} onChange={(e) => setActive((a) => ({ ...a, active_model_album: e.target.value }))}
                  placeholder="Vacío = modelo por defecto del proveedor"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" />
              )}
              <p className="text-xs text-muted-foreground">
                La selección de fotos y la maquetación de lienzos del módulo Álbum usan este proveedor y modelo.
              </p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          En Selección hay failover: si el proveedor activo falla, se reintenta con el siguiente habilitado. En Ajustes,
          el proveedor activo es el único responsable. En Álbum, el proveedor activo se usa primero y, si falla, la cadena
          de Album AI (Gemini de pago → Qwen → NVIDIA) continúa.
        </p>
      </div>

      <NvidiaVisionTest />

      <div className="flex gap-3">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
        </button>
      </div>
    </div>
  );
}