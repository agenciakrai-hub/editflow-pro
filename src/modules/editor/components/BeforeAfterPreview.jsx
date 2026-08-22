import { Image } from "@/components/ui/image";
import { adjustmentsToCssFilter, cropToCssTransform } from "../utils/exposureEngine.js";

export default function BeforeAfterPreview({ photo, adjustments, showBefore, onToggle }) {
  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden relative">
      {photo ? (
        <>
          <Image
            src={photo.file_url}
            className="w-full aspect-[4/3]"
            fittingType="fit"
            style={showBefore ? {} : { filter: adjustmentsToCssFilter(adjustments), transform: cropToCssTransform(adjustments.crop) }}
          />
          <button onClick={onToggle} className="absolute bottom-3 left-3 px-3 py-1.5 bg-black/60 text-white text-xs font-medium rounded-lg">
            {showBefore ? "Ver editado" : "Ver original"}
          </button>
          <div className="absolute bottom-3 right-3 text-xs text-white bg-black/50 px-2 py-1 rounded font-mono">{photo.filename}</div>
        </>
      ) : (
        <div className="w-full aspect-[4/3] flex items-center justify-center text-sm text-muted-foreground">Selecciona una foto</div>
      )}
    </div>
  );
}