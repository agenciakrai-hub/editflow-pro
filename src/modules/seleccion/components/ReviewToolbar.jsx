import { Zap, Upload, Loader2 } from "lucide-react";

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "selected", label: "Seleccionadas" },
  { key: "maybe", label: "Duda" },
  { key: "rejected", label: "Rechazadas" },
];

export default function ReviewToolbar({ counts, filter, setFilter, onRunAI, onUpload, running, progress, uploading }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onRunAI} disabled={running} className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Selección IA
        </button>
        <label className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded-lg text-sm font-semibold cursor-pointer hover:bg-secondary transition-colors">
          <Upload className="w-4 h-4" /> Subir RAW
          <input type="file" multiple accept="image/*,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2" className="hidden" onChange={(e) => onUpload(Array.from(e.target.files))} />
        </label>
      </div>

      {running && (
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex justify-between text-xs mb-1.5"><span>Analizando fotos…</span><span>{progress.done}/{progress.total}</span></div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {uploading && <p className="text-xs text-muted-foreground">Subiendo archivos…</p>}

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${filter === f.key ? "bg-accent text-white" : "bg-card border border-border"}`}>
            {f.label} ({counts[f.key] ?? 0})
          </button>
        ))}
      </div>
    </div>
  );
}