import { useState } from "react";
import { Star, RotateCw, ChevronDown, ChevronUp } from "lucide-react";
import { Image } from "@/components/ui/image";
import { COLOR_LABELS, STAR_VALUES } from "@/lib/rawaistudio/labels";

const STATUS_META = {
  TOP_PICK: { label: "TOP", className: "bg-amber-500 text-black" },
  SELECT: { label: "OK", className: "bg-emerald-500 text-black" },
  REVIEW: { label: "REVISAR", className: "bg-yellow-500 text-black" },
  REJECT: { label: "DESCARTAR", className: "bg-red-500 text-white" },
};

const SCORE_LABELS = {
  technical: "Técnica", sharpness: "Nitidez", focus: "Foco", face_quality: "Caras",
  eye_quality: "Ojos", expression: "Expresión", composition: "Composición",
  exposure: "Exposición", color_quality: "Color", subject_quality: "Sujeto",
  moment_quality: "Momento", distraction_penalty: "Limpieza", overall: "Global", confidence: "Confianza",
};

function ScoreBar({ label, value }) {
  const v = Math.round(value ?? 0);
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-[10px] text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-zinc-300" style={{ width: `${v}%` }} />
      </div>
      <span className="w-6 text-right text-[10px] tabular-nums text-zinc-400">{v}</span>
    </div>
  );
}

export default function PhotoCard({ photo, onUpdate, bulkSelected, onToggleBulk }) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = photo.aiSelected || photo.selectedForEdit;
  // Solo rotación manual: las verticales se muestran en vertical (sin auto-rotación ni recorte).
  const rotation = photo.manualRotation != null ? photo.manualRotation : 0;
  const status = photo.status || (isSelected ? "SELECT" : "REVIEW");
  const meta = STATUS_META[status] || STATUS_META.REVIEW;

  return (
    <div className={`rounded-md border bg-zinc-900 p-2 ${bulkSelected ? "border-accent ring-1 ring-accent" : "border-zinc-800"}`}>
      <div className="relative aspect-square w-full overflow-hidden rounded bg-black/40" style={{ transform: `rotate(${rotation}deg)` }}>
        <Image src={photo.preview?.dataUrl} className="h-full w-full" fittingType="fit" />
        <span className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-bold ${meta.className}`}>
          {meta.label}
        </span>
        {onToggleBulk && (
          <button type="button" onClick={onToggleBulk}
            className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded border ${bulkSelected ? "border-accent bg-accent text-accent-foreground" : "border-white/70 bg-black/50 text-transparent hover:bg-black/70"}`}>
            {bulkSelected ? <span className="text-[11px] font-bold leading-none">✓</span> : null}
          </button>
        )}
        {photo.overallScore != null && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-bold tabular-nums text-white">
            {Math.round(photo.overallScore)}
          </span>
        )}
        {photo.previewWarning && (
          <span className="absolute bottom-1 left-1 rounded bg-orange-600 px-1 py-0.5 text-[8px] font-bold text-white" title="Preview no disponible">
            SIN PREVIEW
          </span>
        )}
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
          Complementaria · grupo de {photo.groupSize}
        </p>
      )}
      {photo.scores && (
        <button onClick={() => setExpanded((e) => !e)}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Detalle
        </button>
      )}
      {expanded && photo.scores && (
        <div className="mt-1 space-y-1 rounded bg-zinc-950 p-2">
          {Object.entries(SCORE_LABELS).map(([k, label]) => (
            <ScoreBar key={k} label={label} value={photo.scores[k]} />
          ))}
          {!photo.analysisComplete && (
            <p className="pt-1 text-[10px] text-amber-400" title="Decisión de fallback técnico, no IA">
              Fallback técnico (IA no disponible)
            </p>
          )}
          {photo.missingDimensions?.length > 0 && (
            <p className="pt-1 text-[10px] leading-tight text-zinc-500">
              No evaluado: {photo.missingDimensions.join(", ")}
            </p>
          )}
          {photo.rejectReasons?.length > 0 && (
            <p className="pt-1 text-[10px] text-red-400">Descarte: {photo.rejectReasons.join(", ")}</p>
          )}
          {photo.reason && <p className="pt-1 text-[10px] leading-tight text-zinc-500">{photo.reason}</p>}
        </div>
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