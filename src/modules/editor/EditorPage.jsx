import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Sparkles, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Image } from "@/components/ui/image";
import { useAutoEdit } from "./hooks/useAutoEdit.js";
import { DEFAULT_ADJUSTMENTS, ensureDefaults } from "./utils/paramDefs.js";
import { CAMERA_PROFILES, DEFAULT_PROFILE } from "./utils/cameraProfiles.js";
import { applyCreativeLayer } from "./utils/presetProfile.js";
import ToolPanels from "./components/ToolPanels.jsx";
import BeforeAfterPreview from "./components/BeforeAfterPreview.jsx";
import PresetStrip from "./components/PresetStrip.jsx";
import PresetUpload from "./components/PresetUpload.jsx";

export default function EditorPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { photos, presets, loading, computing, autoEditOne } = useAutoEdit();
  const [selected, setSelected] = useState(null);
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [activePreset, setActivePreset] = useState(null);
  const [baseAdjustments, setBaseAdjustments] = useState(DEFAULT_ADJUSTMENTS);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [showBefore, setShowBefore] = useState(false);

  const selectPhoto = (ph) => {
    setSelected(ph);
    const adj = ensureDefaults(ph.adjustments);
    setAdjustments(adj);
    setBaseAdjustments(adj);
    setProfile(ph.adjustments?.cameraProfile || DEFAULT_PROFILE);
    setActivePreset(null);
  };

  const applyPreset = (preset) => {
    setActivePreset(preset);
    setAdjustments((prev) => ({ ...applyCreativeLayer(prev, preset), curve: prev.curve, hsl: prev.hsl, grading: prev.grading, crop: prev.crop }));
  };

  // Tool 2 — color layer from an uploaded Lightroom .xmp preset (only temperature/tint).
  const applyPresetColor = (color) => {
    setAdjustments((prev) => ({ ...prev, ...color }));
  };

  const runAuto = async () => {
    if (!selected) return;
    const auto = await autoEditOne(selected);
    const merged = ensureDefaults({ ...adjustments, ...auto });
    setBaseAdjustments(merged);
    setAdjustments(merged);
    setSelected((prev) => ({ ...prev, adjustments: merged, edit_applied: true }));
    toast({ title: "Ajuste IA aplicado", description: selected.filename });
  };

  const save = async () => {
    if (!selected) return;
    const payload = { ...adjustments, cameraProfile: profile, edit_applied: true };
    await base44.entities.Photo.update(selected.id, { adjustments: payload });
    setSelected((prev) => ({ ...prev, adjustments: payload }));
    toast({ title: "Edición guardada", description: selected.filename });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Editor</h1>
        <button onClick={runAuto} disabled={!selected || computing} className="flex items-center gap-1.5 px-3 py-2 bg-secondary rounded-lg text-sm font-semibold hover:bg-secondary/80 disabled:opacity-40">
          {computing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Auto IA
        </button>
        <button onClick={save} disabled={!selected} className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40">
          <Save className="w-4 h-4" /> Guardar
        </button>
      </div>

      <BeforeAfterPreview photo={selected} adjustments={adjustments} showBefore={showBefore} onToggle={() => setShowBefore(!showBefore)} />

      <PresetStrip presets={presets} activePreset={activePreset} onApplyPreset={applyPreset} />

      <PresetUpload onApplyColor={applyPresetColor} />

      <div className="bg-card rounded-2xl border border-border p-4">
        <label className="text-sm font-medium mb-1.5 block">Perfil de cámara</label>
        <select value={profile} onChange={(e) => setProfile(e.target.value)} className="w-full bg-secondary rounded-xl px-4 py-3 text-sm font-medium">
          {CAMERA_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <ToolPanels adjustments={adjustments} setAdjustments={setAdjustments} />

      {loading ? (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">{[...Array(4)].map((_, i) => <div key={i} className="w-16 h-16 bg-card rounded-lg animate-pulse shrink-0" />)}</div>
      ) : photos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Fotos seleccionadas ({photos.length})</h3>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {photos.map((ph) => (
              <button key={ph.id} onClick={() => selectPhoto(ph)} className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${selected?.id === ph.id ? "border-accent" : "border-transparent"}`}>
                <Image src={ph.file_url} className="w-16 h-16" fittingType="fill" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}