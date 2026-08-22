import { Image } from "@/components/ui/image";
import { Star } from "lucide-react";

// Burst comparator: shows the takes within a burst side by side so the user can
// confirm the engine's pick.
export default function BurstComparator({ bursts, selectedBurst, onSelect }) {
  if (!bursts.length) return null;
  return (
    <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-semibold">Comparador por ráfaga</h3>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {bursts.map((b) => (
          <button key={b.key} onClick={() => onSelect(b.key)} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${selectedBurst === b.key ? "bg-accent text-white" : "bg-secondary"}`}>
            {b.key} ({b.photos.length})
          </button>
        ))}
      </div>
      {selectedBurst && (
        <div className="grid grid-cols-2 gap-2">
          {bursts.find((b) => b.key === selectedBurst)?.photos.map((p) => (
            <div key={p.id} className={`relative rounded-xl overflow-hidden border-2 ${p.culling_status === "selected" ? "border-green-500" : "border-transparent"}`}>
              <Image src={p.file_url} className="w-full aspect-square" fittingType="fill" />
              <div className="absolute top-1.5 left-1.5 flex">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`w-3 h-3 ${p.star_rating >= n ? "text-yellow-400 fill-yellow-400" : "text-black/40"}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}