import { Star } from "lucide-react";
import { Image } from "@/components/ui/image";

const STATUS_STYLE = {
  unreviewed: "bg-secondary text-muted-foreground",
  selected: "bg-green-500 text-white",
  maybe: "bg-yellow-500 text-white",
  rejected: "bg-red-500 text-white",
};
const COLOR_DOT = { none: "", red: "bg-red-500", yellow: "bg-yellow-400", green: "bg-green-500", blue: "bg-blue-500", purple: "bg-purple-500" };

export default function PhotoGrid({ photos, onCycleStatus, onRate }) {
  if (!photos.length) {
    return <div className="bg-card rounded-2xl border border-dashed border-border h-48 flex items-center justify-center text-sm text-muted-foreground">No hay fotos en este filtro</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {photos.map((photo) => (
        <div key={photo.id} className="relative bg-card rounded-xl border border-border overflow-hidden">
          <button onClick={() => onCycleStatus(photo)} className="block w-full">
            <Image src={photo.file_url} className="w-full aspect-square" fittingType="fill" />
          </button>
          <div className="absolute top-2 left-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={(e) => { e.stopPropagation(); onRate(photo, n); }} className={`w-5 h-5 rounded flex items-center justify-center ${photo.star_rating >= n ? "bg-yellow-400" : "bg-black/40"}`}>
                <Star className={`w-3 h-3 ${photo.star_rating >= n ? "text-black fill-black" : "text-white"}`} />
              </button>
            ))}
          </div>
          <div className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[photo.culling_status]}`}>
            {photo.culling_status}
          </div>
          {photo.color_label !== "none" && (
            <div className={`absolute bottom-2 left-2 w-4 h-4 rounded-full ${COLOR_DOT[photo.color_label]}`} />
          )}
          <div className="absolute bottom-2 right-2 text-[10px] text-white bg-black/50 px-1.5 py-0.5 rounded font-mono truncate max-w-[60%]">{photo.filename}</div>
        </div>
      ))}
    </div>
  );
}