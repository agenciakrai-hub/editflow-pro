import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Sliders, Sparkles, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/use-toast";

const ADJUSTMENTS = [
  { key: "exposure", label: "Exposición", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "Contraste", min: -100, max: 100, step: 1 },
  { key: "highlights", label: "Luces altas", min: -100, max: 100, step: 1 },
  { key: "shadows", label: "Sombras", min: -100, max: 100, step: 1 },
  { key: "whites", label: "Blancos", min: -100, max: 100, step: 1 },
  { key: "blacks", label: "Negros", min: -100, max: 100, step: 1 },
  { key: "temperature", label: "Temperatura", min: -100, max: 100, step: 1 },
  { key: "tint", label: "Tinte", min: -100, max: 100, step: 1 },
  { key: "vibrance", label: "Vibrancia", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "Saturación", min: -100, max: 100, step: 1 },
  { key: "clarity", label: "Claridad", min: -100, max: 100, step: 1 },
  { key: "sharpness", label: "Nitidez", min: 0, max: 100, step: 1 },
];

const DEFAULT_ADJ = Object.fromEntries(ADJUSTMENTS.map(a => [a.key, 0]));

export default function Editor() {
  const [presets, setPresets] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJ);
  const [loading, setLoading] = useState(true);
  const [showBefore, setShowBefore] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      base44.entities.Preset.list("-updated_date", 50),
      base44.entities.Photo.filter({ culling_status: "selected" }),
    ]).then(([pr, ph]) => {
      setPresets(pr);
      setPhotos(ph);
      if (ph[0]) setSelectedPhoto(ph[0]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const applyPreset = (preset) => {
    setSelectedPreset(preset);
    setAdjustments({ ...DEFAULT_ADJ, ...preset.adjustments });
  };

  const handleSlider = (key, value) => {
    setAdjustments(prev => ({ ...prev, [key]: value[0] }));
  };

  const filterStyle = () => {
    if (showBefore) return {};
    const a = adjustments;
    return {
      filter: `brightness(${1 + a.exposure / 200}) contrast(${1 + a.contrast / 200}) saturate(${1 + a.vibrance / 150}) sepia(${a.temperature / 400})`,
    };
  };

  const saveEdit = async () => {
    if (!selectedPhoto) return;
    await base44.entities.Photo.update(selectedPhoto.id, {
      adjustments,
      edit_applied: true,
      preset_id: selectedPreset?.id ?? null,
    });
    setSelectedPhoto(prev => ({ ...prev, adjustments, edit_applied: true }));
    toast({ title: "Edición guardada", description: `Ajustes aplicados a ${selectedPhoto.filename}` });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Editor</h1>
        <button onClick={saveEdit} disabled={!selectedPhoto} className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
          <Save className="w-4 h-4" /> Guardar
        </button>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden relative">
        {selectedPhoto ? (
          <>
            <Image src={selectedPhoto.file_url} className="w-full aspect-[4/3]" fittingType="fit" style={filterStyle()} />
            <button onClick={() => setShowBefore(!showBefore)} className="absolute bottom-3 left-3 px-3 py-1.5 bg-black/60 text-white text-xs font-medium rounded-lg">
              {showBefore ? "Ver editado" : "Ver original"}
            </button>
            <div className="absolute bottom-3 right-3 text-xs text-white bg-black/50 px-2 py-1 rounded font-mono">{selectedPhoto.filename}</div>
          </>
        ) : (
          <div className="w-full aspect-[4/3] flex items-center justify-center text-sm text-muted-foreground">Selecciona una foto</div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Presets</h3>
        {loading ? (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {[...Array(4)].map((_, i) => <div key={i} className="w-20 h-24 bg-card rounded-xl animate-pulse shrink-0" />)}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {presets.map(p => (
              <button key={p.id} onClick={() => applyPreset(p)} className={`shrink-0 w-20 rounded-xl border-2 overflow-hidden transition-colors ${selectedPreset?.id === p.id ? "border-accent" : "border-transparent"}`}>
                {p.thumbnail_url ? (
                  <Image src={p.thumbnail_url} className="w-20 h-20" fittingType="fill" />
                ) : (
                  <div className="w-20 h-20 bg-secondary" />
                )}
                <p className="text-[10px] font-medium p-1.5 text-left truncate bg-card">{p.name}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Sliders className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Ajustes básicos</h3>
          {selectedPreset && <span className="text-xs text-muted-foreground">· {selectedPreset.name}</span>}
        </div>
        <div className="space-y-3.5">
          {ADJUSTMENTS.map(adj => (
            <div key={adj.key} className="flex items-center gap-3">
              <span className="text-xs font-medium w-24 shrink-0">{adj.label}</span>
              <Slider value={[adjustments[adj.key]]} onValueChange={(v) => handleSlider(adj.key, v)} min={adj.min} max={adj.max} step={adj.step} className="flex-1" />
              <span className="text-xs font-mono w-10 text-right text-muted-foreground">{adjustments[adj.key] > 0 ? "+" : ""}{adjustments[adj.key]}</span>
            </div>
          ))}
        </div>
      </div>

      {photos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Fotos seleccionadas ({photos.length})</h3>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {photos.map(ph => (
              <button key={ph.id} onClick={() => { setSelectedPhoto(ph); setAdjustments({ ...DEFAULT_ADJ, ...(ph.adjustments || {}) }); setSelectedPreset(null); }} className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${selectedPhoto?.id === ph.id ? "border-accent" : "border-transparent"}`}>
                <Image src={ph.file_url} className="w-16 h-16" fittingType="fill" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}