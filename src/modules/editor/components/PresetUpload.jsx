import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { fetchPresetTagValues } from "@/lib/xmp/extractPreset.js";

// Tool 2 — upload a Lightroom .xmp preset and apply its COLOR layer
// (Temperature/Tint) on top of the IA develop values. Does NOT touch the
// tone/presence params computed by the IA motor (Tool 1).
export default function PresetUpload({ onApplyColor }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const uploaded = await base44.integrations.Core.UploadFile({ file });
      const tagValues = await fetchPresetTagValues(uploaded.file_url);
      if (!tagValues) {
        toast({ title: "Preset no válido", description: "El .xmp no contiene parámetros de revelado.", variant: "destructive" });
        return;
      }
      const color = {};
      if (tagValues.Temperature != null) color.temperature = Number(tagValues.Temperature);
      if (tagValues.Tint != null) color.tint = Number(tagValues.Tint);
      onApplyColor(color, file.name);
      toast({ title: "Preset aplicado", description: file.name });
    } catch {
      toast({ title: "Error al subir el preset", variant: "destructive" });
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <h3 className="text-sm font-semibold mb-2">Preset de Lightroom (color)</h3>
      <p className="text-xs text-muted-foreground mb-3">Sube un .xmp de Lightroom. Se aplica solo la capa de color (temperatura/tinte) sobre el ajuste IA.</p>
      <input ref={inputRef} type="file" accept=".xmp" onChange={handleFile} className="hidden" />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-2 bg-secondary rounded-lg text-sm font-semibold hover:bg-secondary/80 disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Subir preset .xmp
      </button>
    </div>
  );
}