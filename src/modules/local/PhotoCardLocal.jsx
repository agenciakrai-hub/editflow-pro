import { Check, X, Eye, Loader2, Trash2 } from "lucide-react";

const STATUS_STYLE = {
  selected: "border-accent",
  rejected: "border-destructive opacity-50",
  maybe: "border-yellow-400",
  unreviewed: "border-border",
};

export default function PhotoCardLocal({ photo, onStatus, onRemove }) {
  return (
    <div className={`relative rounded-lg overflow-hidden border-2 ${STATUS_STYLE[photo.status] || "border-border"} bg-card`}>
      <img src={photo.previewUrl} alt={photo.name} className="w-full h-28 object-cover" />
      {photo.computing && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        </div>
      )}
      {photo.edit_applied && (
        <span className="absolute top-1 right-1 bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded">IA</span>
      )}
      <div className="p-1.5">
        <p className="text-[10px] truncate text-muted-foreground" title={photo.name}>{photo.name}</p>
        <div className="flex items-center gap-1 mt-1">
          <button onClick={() => onStatus(photo.id, "selected")} className="p-1 hover:bg-secondary rounded" title="Seleccionar"><Check className="w-3.5 h-3.5" /></button>
          <button onClick={() => onStatus(photo.id, "maybe")} className="p-1 hover:bg-secondary rounded" title="Dudoso"><Eye className="w-3.5 h-3.5" /></button>
          <button onClick={() => onStatus(photo.id, "rejected")} className="p-1 hover:bg-secondary rounded" title="Rechazar"><X className="w-3.5 h-3.5" /></button>
          <button onClick={() => onRemove(photo.id)} className="p-1 hover:bg-secondary rounded ml-auto" title="Quitar"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}