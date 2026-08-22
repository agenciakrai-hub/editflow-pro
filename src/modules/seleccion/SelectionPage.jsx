import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { useSelectionEngine } from "./hooks/useSelectionEngine.js";
import { groupByBursts } from "./utils/burstGrouping.js";
import ReviewToolbar from "./components/ReviewToolbar.jsx";
import PhotoGrid from "./components/PhotoGrid.jsx";
import BurstComparator from "./components/BurstComparator.jsx";

export default function SelectionPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const engine = useSelectionEngine();
  const { projects, selectedProject, photos, loading, running, progress, uploading } = engine;
  const [filter, setFilter] = useState("all");
  const [dropdown, setDropdown] = useState(false);
  const [selectedBurst, setSelectedBurst] = useState(null);

  const counts = useMemo(() => ({
    all: photos.length,
    selected: photos.filter((p) => p.culling_status === "selected").length,
    maybe: photos.filter((p) => p.culling_status === "maybe").length,
    rejected: photos.filter((p) => p.culling_status === "rejected").length,
  }), [photos]);

  const filtered = filter === "all" ? photos : photos.filter((p) => p.culling_status === filter);
  const bursts = useMemo(() => groupByBursts(photos), [photos]);

  const cycleStatus = async (photo) => {
    const order = ["unreviewed", "selected", "maybe", "rejected"];
    const next = order[(order.indexOf(photo.culling_status) + 1) % order.length];
    await base44.entities.Photo.update(photo.id, { culling_status: next });
    engine.setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, culling_status: next } : p)));
  };

  const rate = async (photo, n) => {
    const value = photo.star_rating === n ? 0 : n;
    await base44.entities.Photo.update(photo.id, { star_rating: value });
    engine.setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, star_rating: value } : p)));
  };

  const handleRun = async () => {
    toast({ title: "IA analizando fotos…" });
    const selectedCount = await engine.runAI();
    toast({ title: "Selección IA completada", description: `${selectedCount} fotos seleccionadas` });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Selección IA</h1>
      </div>

      <div className="relative">
        <button onClick={() => setDropdown(!dropdown)} className="flex items-center justify-between w-full bg-card border border-border rounded-xl px-4 py-3 text-sm font-semibold">
          {selectedProject?.title ?? "Selecciona un proyecto"} <ChevronDown className="w-4 h-4" />
        </button>
        {dropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
            {projects.map((p) => (
              <button key={p.id} onClick={() => { engine.loadPhotos(p.id, p); setDropdown(false); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-secondary">
                {p.title} <span className="text-muted-foreground">· {p.photo_count} fotos</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ReviewToolbar counts={counts} filter={filter} setFilter={setFilter} onRunAI={handleRun} onUpload={engine.uploadFiles} running={running} progress={progress} uploading={uploading} />

      {loading ? (
        <div className="grid grid-cols-2 gap-3">{[...Array(6)].map((_, i) => <div key={i} className="aspect-square bg-card rounded-xl animate-pulse" />)}</div>
      ) : (
        <>
          <BurstComparator bursts={bursts} selectedBurst={selectedBurst} onSelect={setSelectedBurst} />
          <PhotoGrid photos={filtered} onCycleStatus={cycleStatus} onRate={rate} />
        </>
      )}
    </div>
  );
}