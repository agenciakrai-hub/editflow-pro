import { Star, RotateCw } from "lucide-react";
import { Image } from "@/components/ui/image";
import { COLOR_LABELS, STAR_VALUES } from "@/lib/rawaistudio/labels";

export default function PhotoCard({ photo, onUpdate }) {
  const preview = photo.preview;
  const isPortrait = preview && preview.height > preview.width;
  const isSelected = photo.aiSelected || photo.selectedForEdit;
  const autoRotation = isSelected && isPortrait ? 90 : 0;
  const rotation = photo.manualRotation != null ? photo.manualRotation : autoRotation;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
      <div className="relative h-28 w-full overflow-hidden rounded" style={{ transform: `rotate(${rotation}deg)` }}>
        <Image src={photo.preview?.dataUrl} className="h-full w-full" fittingType="fill" />
      </div>
      <button onClick={() => onUpdate({ manualRotation: (rotation + 90) % 360 })}
        className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300">
        <RotateCw className="h-3 w-3" /> Rotar
      </button>
      <p className="mt-1 truncate text-xs text-zinc-400">{photo.file.name}</p>
      <button onClick={() => onUpdate({ selectedForEdit: !photo.selectedForEdit })}
        className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${photo.selectedForEdit ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
        {photo.selectedForEdit ? "En edición" : "Fuera de edición"}
      </button>
      {photo.complementary && (
        <p className="mt-1 text-[10px] text-amber-400" title={photo.reason || ""}>
          Fusión / Photoshop · grupo de {photo.groupSize}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1">
        {STAR_VALUES.map((n) => (
          <button key={n} onClick={() => onUpdate({ rating: photo.rating === n ? 0 : n })}>
            <Star className={`h-3.5 w-3.5 ${photo.rating >= n ? "fill-yellow-400 text-yellow-400" : "text-zinc-600"}`} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {COLOR_LABELS.map((c) => (
          <button key={c.key} title={c.label} onClick={() => onUpdate({ colorLabel: c.key })}
            className={`h-4 w-4 rounded-full border-2 ${photo.colorLabel === c.key ? "border-white" : "border-transparent"}`}
            style={{ backgroundColor: c.color }} />
        ))}
      </div>
    </div>
  );
}