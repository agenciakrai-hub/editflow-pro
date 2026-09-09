import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Loader2, ShieldCheck, Sparkles, Images, SlidersHorizontal, BookOpen } from "lucide-react";
import { getWorkMode, setWorkMode, subscribeWorkMode, WORK_MODES } from "@/lib/workMode";
import { readLocalFolder } from "./core/extractPreviews";
import { buildReliableBursts } from "./core/burstGrouping";
import { analyzeAlbumSelection, decideBasicEdits, selectReliable } from "./core/workflowClient";
import { useToast } from "@/components/ui/use-toast";

const STATUS_STYLE = {
  TOP_PICK: "bg-emerald-600 text-white",
  SELECT: "bg-emerald-100 text-emerald-800",
  REVIEW: "bg-amber-100 text-amber-800",
  REJECT: "bg-red-100 text-red-800",
};

export default function WorkflowV2Page() {
  const { toast } = useToast();
  const [mode, setModeState] = useState(getWorkMode);
  const [photos, setPhotos] = useState([]);
  const [bursts, setBursts] = useState([]);
  const [decisions, setDecisions] = useState(new Map());
  const [recipes, setRecipes] = useState(new Map());
  const [album, setAlbum] = useState(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => subscribeWorkMode(setModeState), []);
  const selected = useMemo(() => photos.filter((photo) => ["TOP_PICK", "SELECT"].includes(decisions.get(photo.id)?.status)), [photos, decisions]);

  const chooseMode = (next) => setModeState(setWorkMode(next));

  const pickFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      setBusy("read"); setProgress({ done: 0, total: 0 }); setDecisions(new Map()); setRecipes(new Map()); setAlbum(null);
      const loaded = await readLocalFolder(handle, (done, total) => setProgress({ done, total }));
      const grouped = buildReliableBursts(loaded);
      setPhotos(loaded); setBursts(grouped);
      toast({ title: "Lectura local completada", description: `${loaded.length} fotos · ${grouped.length} grupos. Ningún original se ha subido.` });
    } catch (error) {
      if (error?.name !== "AbortError") toast({ title: "No se pudo leer la carpeta", description: error.message, variant: "destructive" });
    } finally { setBusy(""); }
  };

  const runSelection = async () => {
    setBusy("select"); setProgress({ done: 0, total: bursts.length });
    try {
      setDecisions(await selectReliable(bursts, mode, (done, total) => setProgress({ done, total })));
    } catch (error) { toast({ title: "Selección incompleta", description: error.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  const runEditing = async () => {
    if (!selected.length) return;
    setBusy("edit"); setProgress({ done: 0, total: selected.length });
    try { setRecipes(await decideBasicEdits(selected, mode, (done, total) => setProgress({ done, total }))); }
    catch (error) { toast({ title: "Edición incompleta", description: error.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  const runAlbum = async () => {
    if (!selected.length) return;
    setBusy("album");
    try { setAlbum(await analyzeAlbumSelection(selected, mode)); }
    catch (error) { toast({ title: "Análisis de álbum incompleto", description: error.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Flujo IA V2</h1>
          <p className="mt-1 text-sm text-muted-foreground">Proceso nuevo y aislado: ráfagas → selección → ajustes básicos → álbum.</p>
        </div>
        <div className="flex rounded-xl border border-border bg-secondary p-1">
          <button onClick={() => chooseMode(WORK_MODES.BASIC)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "basic" ? "bg-card shadow" : "text-muted-foreground"}`}>Básico</button>
          <button onClick={() => chooseMode(WORK_MODES.PRO)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${mode === "pro" ? "bg-accent text-accent-foreground shadow" : "text-muted-foreground"}`}>Pro</button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4"><ShieldCheck className="h-5 w-5 text-emerald-600" /><p className="mt-2 text-sm font-semibold">Original protegido</p><p className="text-xs text-muted-foreground">RAW solo en tu ordenador/disco. Acceso de lectura.</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><Sparkles className="h-5 w-5 text-accent" /><p className="mt-2 text-sm font-semibold">Sin créditos Base44</p><p className="text-xs text-muted-foreground">Solo proveedor externo propio y previews reducidas en memoria.</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><Images className="h-5 w-5 text-accent" /><p className="mt-2 text-sm font-semibold">Decisión conservadora</p><p className="text-xs text-muted-foreground">Baja confianza = Revisión; nunca descarte automático.</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={pickFolder} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"><FolderOpen className="h-4 w-4" /> Elegir carpeta RAW</button>
        <button onClick={runSelection} disabled={!!busy || !bursts.length} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40"><Images className="h-4 w-4" /> Seleccionar</button>
        <button onClick={runEditing} disabled={!!busy || !selected.length} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40"><SlidersHorizontal className="h-4 w-4" /> Decidir ajustes</button>
        <button onClick={runAlbum} disabled={!!busy || !selected.length} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40"><BookOpen className="h-4 w-4" /> Preparar álbum</button>
      </div>

      {busy && <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Procesando {progress.total ? `${progress.done} / ${progress.total}` : "…"}</div>}

      {photos.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap gap-4 text-sm"><span><b>{photos.length}</b> fotos</span><span><b>{bursts.length}</b> grupos</span><span><b>{selected.length}</b> seleccionadas</span><span><b>{recipes.size}</b> recetas</span></div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-8">
            {photos.map((photo) => {
              const decision = decisions.get(photo.id);
              return <div key={photo.id} className="overflow-hidden rounded-lg border border-border bg-secondary">
                {photo.preview?.dataUrl ? <img src={photo.preview.dataUrl} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square" />}
                <div className="p-1.5"><p className="truncate text-[10px]">{photo.file.name}</p>{decision && <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${STATUS_STYLE[decision.status] || STATUS_STYLE.REVIEW}`}>{decision.status} · {decision.confidence || 0}%</span>}</div>
              </div>;
            })}
          </div>
        </div>
      )}

      {album && <div className="rounded-xl border border-border bg-card p-4 text-sm"><p className="font-semibold">Álbum preparado</p><p className="mt-1 text-muted-foreground">{album.photos?.length || 0} fotografías analizadas para importancia, orientación y punto de interés.</p></div>}
    </div>
  );
}
