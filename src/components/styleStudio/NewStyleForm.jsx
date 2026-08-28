// Formulario para crear un nuevo estilo: nombre + URL de galería pública → análisis IA
// externo → guardado del perfil. No usa InvokeLLM; el backend enruta al proveedor
// configurado en active_ajustes y devuelve error si no hay proveedor externo válido.
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function NewStyleForm({ onCreated }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [galleryUrl, setGalleryUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const canSubmit = name.trim() && galleryUrl.trim() && !analyzing;

  const submit = async () => {
    if (!canSubmit) return;
    setAnalyzing(true);
    try {
      const res = await base44.functions.invoke("styleGalleryAnalyze", {
        gallery_url: galleryUrl.trim(),
      });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);

      const profile = await base44.entities.PhotographerStyleProfile.create({
        name: name.trim(),
        color_profile: data.color_profile || {},
        edit_profile: data.edit_profile || {},
        creative_recipe: data.creative_recipe || {},
        confidence: data.confidence ?? 0,
        source: data.source || {},
      });

      setName("");
      setGalleryUrl("");
      onCreated(profile);
    } catch (e) {
      toast({
        title: "No se pudo crear el estilo",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">Crear un nuevo estilo</h2>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Nombre del estilo</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ej. Boda cálida natural"
          className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">URL de galería pública</label>
        <input
          value={galleryUrl}
          onChange={(e) => setGalleryUrl(e.target.value)}
          placeholder="https://... (SmugMug, galería HTML pública o URLs de fotos)"
          className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          El análisis usa una única llamada al proveedor IA configurado en Proveedores IA (Gemini/Qwen/NVIDIA).
          No usa InvokeLLM ni créditos de integración.
        </p>
      </div>
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
      >
        {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {analyzing ? "Analizando galería…" : "Analizar y guardar"}
      </button>
    </div>
  );
}