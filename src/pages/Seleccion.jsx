import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, ArrowRight, Sparkles, RotateCcw } from "lucide-react";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews, runAiBurstSelection, buildPhotoFromSelection } from "@/lib/rawaistudio/smartSelectionEngine";
import { setSession } from "@/lib/rawaistudio/localSession";
import { COLOR_LABELS } from "@/lib/rawaistudio/labels";
import PhotoCard from "@/components/rawaistudio/PhotoCard";
import ReviewFilters from "@/components/rawaistudio/ReviewFilters";

// Pantalla de SELECCIÓN (local, mismo diseño que RAW AI Studio). Importa una carpeta de
// RAW, agrupa ráfagas, la IA marca en verde las mejores tomas, el fotógrafo revisa y
// confirma la cola de edición. Los RAW nunca se suben: solo su preview embebida (JPEG
// decodificado en el navegador) se envía a la IA de selección.
export default function Seleccion() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [stage, setStage] = useState("idle"); // idle | previews | selecting | review
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);

  const [quickFilter, setQuickFilter] = useState("selected");
  const [colorFilter, setColorFilter] = useState(new Set(COLOR_LABELS.map((c) => c.key)));
  const [minStars, setMinStars] = useState(0);

  const onPick = (list) => {
    const raws = Array.from(list || []).filter((f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name));
    if (!raws.length) return;
    setFiles(raws);
    runSelection(raws);
  };

  const runSelection = async (raws) => {
    setError(null);
    setStage("previews");
    setTotal(raws.length);
    setDone(0);
    const items = raws.map((file, i) => ({ id: String(i), file }));
    const withPreview = await extractPreviews(items, (d) => setDone(d));

    setStage("selecting");
    setTotal(withPreview.length);
    setDone(0);
    const { keep, meta } = await runAiBurstSelection(withPreview, (d) => setDone(d));
    const built = withPreview.map((p) => buildPhotoFromSelection(p, keep, meta));
    setPhotos(built);
    setStage("review");
  };

  const toggleColor = (key) => {
    setColorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const update = (id, patch) => setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const visible = useMemo(() => photos.filter((p) => {
    if (quickFilter === "selected" && !p.aiSelected) return false;
    if (quickFilter === "unselected" && p.aiSelected) return false;
    return colorFilter.has(p.colorLabel) && p.rating >= minStars;
  }), [photos, quickFilter, colorFilter, minStars]);

  const selectedCount = photos.filter((p) => p.aiSelected).length;
  const editCount = photos.filter((p) => p.selectedForEdit).length;

  const confirmEdit = () => {
    const queue = photos.filter((p) => p.selectedForEdit);
    setSession({ photos: queue });
    navigate("/editor");
  };

  const reset = () => {
    setFiles([]); setPhotos([]); setStage("idle"); setDone(0); setTotal(0); setError(null);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] rounded-xl bg-[#0a0a0a] p-4 sm:p-6 text-zinc-100">
      <p className="text-sm text-zinc-500">Selección IA</p>
      <h1 className="mt-1 text-2xl font-semibold">Selección y culling de bodas</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
        Importa la carpeta, la IA agrupa ráfagas y marca en verde las mejores tomas, revisa
        y confirma la cola de edición. Los RAW nunca se modifican ni se suben.
      </p>

      {stage === "idle" && (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-700 bg-[#141414] p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-zinc-500" />
          <p className="mt-3 text-sm text-zinc-400">Elige la carpeta de RAW a analizar</p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
            <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
            <input type="file" className="hidden" webkitdirectory="" directory="" multiple
              onChange={(e) => onPick(e.target.files)} />
          </label>
          <label className="mt-2 block text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
            o selecciona archivos sueltos
            <input type="file" className="hidden" multiple
              onChange={(e) => onPick(e.target.files)} />
          </label>
        </div>
      )}

      {(stage === "previews" || stage === "selecting") && (
        <section className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <p className="text-sm font-medium">
            {stage === "previews" ? "Leyendo previews embebidas" : "Analizando ráfagas con IA"}
          </p>
          <p className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {done} / {total}
          </p>
        </section>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {stage === "review" && (
        <section className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Revisión — {selectedCount} / {photos.length} seleccionadas por la IA</p>
              <p className="mt-1 text-xs text-emerald-400">{editCount} fotos en la cola de edición</p>
            </div>
            <button onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
              <RotateCcw className="h-3.5 w-3.5" /> Otra carpeta
            </button>
          </div>
          <div className="mt-4">
            <ReviewFilters quickFilter={quickFilter} onQuickFilter={setQuickFilter} colorFilter={colorFilter}
              onToggleColor={toggleColor} minStars={minStars} onMinStars={setMinStars} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {visible.map((p) => (<PhotoCard key={p.id} photo={p} onUpdate={(patch) => update(p.id, patch)} />))}
          </div>
          {!visible.length && <p className="mt-6 text-sm text-zinc-500">No hay fotos con estos filtros.</p>}
          <button onClick={confirmEdit} disabled={!editCount}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
            Confirmar cola de edición ({editCount}) <ArrowRight className="h-4 w-4" />
          </button>
        </section>
      )}
    </div>
  );
}