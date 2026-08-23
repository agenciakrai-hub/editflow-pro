import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Loader2, ArrowRight, Sparkles, RotateCcw, Download, Save } from "lucide-react";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews, buildPhotoFromSelection } from "@/lib/rawaistudio/smartSelectionEngine";
import { selectBursts } from "@/lib/ai/aiGateway";
import { addRatingAndLabel } from "@/lib/rawaistudio/xmpTagPatcher";
import { base44 } from "@/api/base44Client";
import { setSession } from "@/lib/rawaistudio/localSession";
import { COLOR_LABELS, lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { useToast } from "@/components/ui/use-toast";
import PhotoCard from "@/components/rawaistudio/PhotoCard";
import ReviewFilters from "@/components/rawaistudio/ReviewFilters";

// Pantalla de SELECCIÓN (local, mismo diseño que RAW AI Studio). Importa una carpeta de
// RAW, agrupa ráfagas, la IA marca en verde las mejores tomas, el fotógrafo revisa y
// confirma la cola de edición. Los RAW nunca se suben: solo su preview embebida (JPEG
// decodificado en el navegador) se envía a la IA de selección.
// Plantilla XMP mínima para los sidecars de selección: solo rating + label, sin
// ajustes de revelado. Cada foto recibe su sidecar con su estado real.
const SELECTION_XMP_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"/>
  </rdf:RDF>
</x:xmpmeta>`;

export default function Seleccion() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [files, setFiles] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [stage, setStage] = useState("idle"); // idle | previews | selecting | review
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [selectionFallback, setSelectionFallback] = useState(null);
  const [selectionCoverage, setSelectionCoverage] = useState(null);

  const [quickFilter, setQuickFilter] = useState("select");
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
    const { keep, meta, selection_fallback, fallback_reason, selection_coverage_fallback, coverage_promotions } = await selectBursts(withPreview, (d, t) => {
      setDone(d);
      if (typeof t === "number") setTotal(t);
    });
    const built = withPreview.map((p) => buildPhotoFromSelection(p, keep, meta));
    setPhotos(built);
    setSelectionFallback(selection_fallback ? { active: true, reason: fallback_reason } : null);
    setSelectionCoverage(selection_coverage_fallback ? { active: true, promotions: coverage_promotions || [] } : null);
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
    if (quickFilter === "top" && p.status !== "TOP_PICK") return false;
    if (quickFilter === "select" && p.status !== "SELECT") return false;
    if (quickFilter === "review" && p.status !== "REVIEW") return false;
    if (quickFilter === "reject" && p.status !== "REJECT") return false;
    return colorFilter.has(p.colorLabel) && p.rating >= minStars;
  }), [photos, quickFilter, colorFilter, minStars]);

  const selectedCount = photos.filter((p) => p.aiSelected).length;
  const editCount = photos.filter((p) => p.selectedForEdit).length;
  const topCount = photos.filter((p) => p.status === "TOP_PICK").length;
  const reviewCount = photos.filter((p) => p.status === "REVIEW").length;
  const rejectCount = photos.filter((p) => p.status === "REJECT").length;

  const [downloadingSel, setDownloadingSel] = useState(false);

  // Guarda SOLO metadatos del proyecto en la base de datos (sin previews ni RAW).
  // Permite al fotógrafo volver a ver qué quedó seleccionado entre sesiones; las imágenes
  // hay que recargarlas para volver a procesar.
  const guardarProyecto = async () => {
    if (!photos.length) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const title = window.prompt("Nombre del proyecto", `Selección ${hoy}`);
    if (!title || !title.trim()) return;
    setGuardando(true);
    try {
      await base44.entities.Project.create({
        title: title.trim(),
        event_date: hoy,
        status: "selection",
        photo_count: photos.length,
        selected_count: selectedCount,
        edited_count: 0,
        photos_metadata: photos.map((p) => ({
          filename: p.file.name,
          status: p.status,
          rating: p.rating || 0,
          color_label: p.colorLabel || "none",
          edit_applied: !!p.edit_applied,
        })),
      });
      toast({ title: "Proyecto guardado", description: `${photos.length} fotos · ${selectedCount} seleccionadas` });
    } catch (e) {
      toast({ title: "No se pudo guardar", description: e?.message, variant: "destructive" });
    }
    setGuardando(false);
  };

  const confirmEdit = () => {
    const queue = photos.filter((p) => p.selectedForEdit);
    setSession({ photos: queue });
    navigate("/ajustes-ia");
  };

  // Descarga determinista del XMP de selección: un sidecar por CADA foto. Usa el rating y
  // color REALES de la foto (los que dejó la IA o el fotógrafo en la revisión) y NUNCA los
  // rederiva del estado: así el verde + 5★ que la selección marcó se respetan tal cual en
  // el sidecar y Lightroom los reconoce, sin que ningún paso posterior los sobrescriba.
  // Sin ajustes de revelado, sin IA, sin UploadFile. ZIP vía editflow-engine zip-xmp.
  const downloadSelectionXmp = async () => {
    if (!photos.length) return;
    setDownloadingSel(true);
    try {
      const jobs = photos.map((p) => {
        const rating = p.rating || 0;
        const label = p.colorLabel && p.colorLabel !== "none" ? lightroomLabelFor(p.colorLabel) : null;
        let xmp = SELECTION_XMP_TEMPLATE;
        xmp = addRatingAndLabel(xmp, { rating, label });
        return { filename: p.file.name, xmp_content: xmp };
      });
      const res = await base44.functions.invoke("editflow-engine", { action: "zip-xmp", jobs });
      const url = res?.data?.downloadUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "EditFlowPro-Seleccion.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      setError(e?.message || "Error al generar el ZIP de selección");
    }
    setDownloadingSel(false);
  };

  const reset = () => {
    setFiles([]); setPhotos([]); setStage("idle"); setDone(0); setTotal(0); setError(null); setSelectionFallback(null); setSelectionCoverage(null);
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
              <p className="mt-1 text-xs text-zinc-400">
                <span className="text-amber-400">{topCount} top picks</span> ·{" "}
                <span className="text-emerald-400">{selectedCount} seleccionadas</span> ·{" "}
                <span className="text-yellow-500">{reviewCount} a revisar</span> ·{" "}
                <span className="text-red-400">{rejectCount} descartadas</span> ·{" "}
                <span className="text-emerald-400">{editCount} en cola de edición</span>
              </p>
              {selectionCoverage?.active && (
                <p className="mt-2 text-xs text-amber-300">
                  selection_coverage_fallback=true · {selectionCoverage.promotions.length} grupo(s) sin representante: {selectionCoverage.promotions.map((p) => `coverage_fallback_group=${p.group} coverage_fallback_photo=${p.photo} (${p.reason})`).join(" · ")}
                </p>
              )}
              {selectionFallback?.active && (
                <p className="mt-2 text-xs text-amber-300">
                  selection_fallback=true · fallback_reason={selectionFallback.reason} — la IA no devolvió TOP_PICK; se promocionó deterministamente la mejor candidata (sin nueva llamada IA, sin créditos).
                </p>
              )}
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
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={downloadSelectionXmp} disabled={!photos.length || downloadingSel}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
              {downloadingSel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Descargar XMP de selección
            </button>
            <button onClick={guardarProyecto} disabled={!photos.length || guardando}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar proyecto
            </button>
            <button onClick={confirmEdit} disabled={!editCount}
              className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">
              Confirmar cola de edición ({editCount}) <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}