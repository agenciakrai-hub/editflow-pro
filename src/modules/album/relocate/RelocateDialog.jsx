import React, { useState } from "react";
import { ImageOff, Link2, Loader2, X } from "lucide-react";
import { pickFolder, filesFromHandle, cachePhotoPreviews } from "@/modules/album/import/folderImport";
import { scanCandidates, planRelocation } from "@/modules/album/relocate/relocatePhotos";
import { updatePhoto, bulkUpdatePhotos } from "@/modules/album/hooks/useAlbumProject";
import { useToast } from "@/components/ui/use-toast";

// Fase 3.1 Bloque 5 — Photo relocation. Las coincidencias EXACTAS (SHA-256 o
// nombre+tamaño) se enlazan automáticamente; las DIFUSAS (pHash) exigen confirmación
// visual del usuario. Solo se actualiza la REFERENCIA de la foto (metadatos + previews
// locales): jamás se tocan los archivos originales ni la geometría de los spreads.
const relinkPatch = (c) => ({
  filename: c.name,
  relative_path: c.relative_path || c.name,
  preview_status: "ok",
  ...(c.file_size != null ? { file_size: c.file_size } : {}),
  ...(c.content_hash ? { content_hash: c.content_hash } : {}),
  ...(c.phash ? { phash: c.phash } : {}),
  ...(c.width_px != null ? { width_px: c.width_px } : {}),
  ...(c.height_px != null ? { height_px: c.height_px } : {}),
});

export default function RelocateDialog({ projectId, photos, onClose, onApplied }) {
  const { toast } = useToast();
  const [phase, setPhase] = useState("idle"); // idle | scanning | review | applying
  const [progress, setProgress] = useState(null);
  const [plan, setPlan] = useState(null);
  const [accepted, setAccepted] = useState({}); // photoId -> índice de opción difusa aceptada
  const [markUnlinked, setMarkUnlinked] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setError(null);
    setPhase("scanning");
    setProgress({ d: 0, t: 1 });
    try {
      const handle = await pickFolder();
      const files = await filesFromHandle(handle);
      const candidates = await scanCandidates(files, (d, t) => setProgress({ d, t }));
      setPlan(planRelocation(photos, candidates));
      setPhase("review");
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "No se pudo escanear la carpeta");
      setPhase("idle");
    }
  };

  const pendingCount = plan
    ? plan.unmatched.length + plan.fuzzy.filter((f) => accepted[f.photo.id] == null).length
    : 0;

  const apply = async () => {
    if (!plan) return;
    setPhase("applying");
    const applied = [];
    try {
      for (const m of plan.auto) {
        await cachePhotoPreviews(projectId, m.photo.id, { thumb: m.candidate.thumb, preview: m.candidate.preview });
        const patch = relinkPatch(m.candidate);
        await updatePhoto(m.photo.id, patch);
        applied.push({ id: m.photo.id, patch });
      }
      for (const f of plan.fuzzy) {
        const idx = accepted[f.photo.id];
        if (idx == null) continue;
        const c = f.options[idx]?.candidate;
        if (!c) continue;
        await cachePhotoPreviews(projectId, f.photo.id, { thumb: c.thumb, preview: c.preview });
        const patch = relinkPatch(c);
        await updatePhoto(f.photo.id, patch);
        applied.push({ id: f.photo.id, patch });
      }
      const stillMissing = [
        ...plan.fuzzy.filter((f) => accepted[f.photo.id] == null).map((f) => f.photo),
        ...plan.unmatched,
      ];
      if (markUnlinked && stillMissing.length) {
        await bulkUpdatePhotos(stillMissing.map((p) => ({ id: p.id, preview_status: "unlinked" })));
        stillMissing.forEach((p) => applied.push({ id: p.id, patch: { preview_status: "unlinked" } }));
      }
      const relinked = applied.filter((a) => a.patch.preview_status === "ok").length;
      toast({ title: "Re-localización aplicada", description: `${relinked} foto(s) re-enlazada(s) · ${applied.length - relinked} desvinculada(s).` });
      onApplied(applied);
    } catch (e) {
      setError(e?.message || "No se pudo aplicar la re-localización");
      setPhase("review");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={phase === "idle" ? onClose : undefined}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-semibold">Relocalizar fotografías ({photos.length} sin preview)</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {phase === "idle" && (
            <>
              <p className="text-xs leading-5 text-muted-foreground">
                Selecciona la carpeta (o una copia de ella) con las fotos originales. Las coincidencias
                exactas por SHA-256 o nombre+tamaño se enlazan solas; las parecidas visualmente
                requerirán tu confirmación. Ningún archivo se modifica.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button onClick={run}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
                <Link2 className="h-3.5 w-3.5" /> Elegir carpeta y buscar coincidencias
              </button>
            </>
          )}

          {phase === "scanning" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando carpeta… {progress ? `${progress.d}/${progress.t}` : ""}
            </div>
          )}

          {phase === "review" && plan && (
            <>
              <div className={"rounded-lg border p-2.5 text-xs " + (plan.auto.length ? "border-emerald-500/40 bg-emerald-500/10" : "border-border")}>
                <p className={"font-semibold " + (plan.auto.length ? "text-emerald-700" : "text-muted-foreground")}>
                  Coincidencias exactas: {plan.auto.length} (enlace automático)
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  {plan.auto.slice(0, 12).map((m) => (
                    <li key={m.photo.id} className="truncate">
                      {m.photo.filename} → {m.candidate.name} ({m.level === "exact" ? "SHA-256" : "nombre+tamaño"})
                    </li>
                  ))}
                  {plan.auto.length > 12 && <li>… y {plan.auto.length - 12} más</li>}
                </ul>
              </div>

              {plan.fuzzy.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-600">Parecidas visualmente — {plan.fuzzy.length} requieren tu confirmación (nunca se enlazan solas):</p>
                  {plan.fuzzy.map((f) => (
                    <div key={f.photo.id} className="rounded-lg border border-border p-2.5">
                      <p className="truncate text-xs font-medium">{f.photo.filename}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {f.options.map((o, i) => (
                          <button key={i}
                            onClick={() => setAccepted((prev) => ({ ...prev, [f.photo.id]: accepted[f.photo.id] === i ? undefined : i }))}
                            className={"overflow-hidden rounded border text-left " + (accepted[f.photo.id] === i ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/40")}>
                            {o.candidate.thumb ? (
                              <img src={o.candidate.thumb} className="aspect-square w-full object-cover" draggable={false} alt="" />
                            ) : (
                              <div className="flex aspect-square items-center justify-center text-muted-foreground"><ImageOff className="h-4 w-4" /></div>
                            )}
                            <span className="block truncate px-1 pt-0.5 text-[9px]">{o.candidate.name}</span>
                            <span className="block px-1 pb-0.5 text-[9px] text-muted-foreground">distancia {o.distance}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendingCount > 0 && (
                <label className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs">
                  <input type="checkbox" checked={markUnlinked} onChange={(e) => setMarkUnlinked(e.target.checked)} />
                  Marcar {pendingCount} foto(s) sin coincidencia como desvinculadas (unlinked)
                </label>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          )}

          {phase === "applying" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Aplicando re-localización…
            </div>
          )}
        </div>

        {phase === "review" && plan && (
          <div className="flex items-center justify-end gap-2 border-t border-border p-3">
            <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary">Cerrar</button>
            <button onClick={apply} disabled={plan.auto.length === 0 && Object.keys(accepted).length === 0 && !markUnlinked}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40">
              Aplicar ({plan.auto.length + Object.keys(accepted).length + (markUnlinked ? pendingCount : 0)})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}