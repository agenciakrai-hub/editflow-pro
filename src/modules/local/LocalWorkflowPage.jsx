import { useRef, useState } from "react";
import { FolderOpen, FileUp, Sparkles, Download, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useLocalPhotos } from "./useLocalPhotos.js";
import { computeAutoAdjustmentsFromBase64 } from "@/modules/editor/utils/exposureEngine.js";
import { downloadAllXmp } from "./xmpDownload.js";
import PhotoCardLocal from "./PhotoCardLocal.jsx";

export default function LocalWorkflowPage() {
  const { photos, processing, addFiles, setStatus, remove, clear, setPhotos } = useLocalPhotos();
  const folderInput = useRef(null);
  const fileInput = useRef(null);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const selected = photos.filter((p) => p.status === "selected");

  const onPick = (e) => {
    const files = e.target.files;
    if (files && files.length) addFiles(files);
    e.target.value = "";
  };

  const autoEdit = async () => {
    if (!selected.length) {
      toast({ title: "Selecciona fotos primero", variant: "destructive" });
      return;
    }
    setBusy(true);
    for (const p of selected) {
      setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, computing: true } : x)));
      const adj = await computeAutoAdjustmentsFromBase64(p.base64);
      setPhotos((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, adjustments: adj, computing: false, edit_applied: true } : x))
      );
    }
    setBusy(false);
    toast({ title: "Ajuste IA aplicado", description: `${selected.length} fotos` });
  };

  const download = async () => {
    const targets = selected.length ? selected : photos.filter((p) => p.status !== "rejected");
    if (!targets.length) {
      toast({ title: "No hay fotos para exportar", variant: "destructive" });
      return;
    }
    setBusy(true);
    await downloadAllXmp(targets);
    setBusy(false);
    toast({ title: "XMP descargados", description: `${targets.length} archivos` });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Flujo local</h1>
        <p className="text-sm text-muted-foreground">
          Tus RAW no se suben: se leen en tu navegador y la app genera los .xmp para Lightroom.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => folderInput.current?.click()}
          disabled={processing}
          className="flex items-center gap-1.5 px-3 py-2 bg-secondary rounded-lg text-sm font-semibold hover:bg-secondary/80 disabled:opacity-40"
        >
          {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />} Seleccionar carpeta
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={processing}
          className="flex items-center gap-1.5 px-3 py-2 bg-secondary rounded-lg text-sm font-semibold hover:bg-secondary/80 disabled:opacity-40"
        >
          <FileUp className="w-4 h-4" /> Archivos sueltos
        </button>
        <input ref={folderInput} type="file" webkitdirectory="" directory="" multiple onChange={onPick} className="hidden" />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.orf,.rw2,.pef,.srw,.x3f,.raw"
          onChange={onPick}
          className="hidden"
        />
      </div>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={autoEdit}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Auto IA ({selected.length})
          </button>
          <button
            onClick={download}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 bg-secondary rounded-lg text-sm font-semibold hover:bg-secondary/80 disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Descargar XMP
          </button>
          <button
            onClick={clear}
            className="flex items-center gap-1.5 px-3 py-2 bg-secondary rounded-lg text-sm font-semibold hover:bg-secondary/80"
          >
            <Trash2 className="w-4 h-4" /> Limpiar
          </button>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">
          Selecciona una carpeta o archivos RAW para empezar.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {photos.map((p) => (
            <PhotoCardLocal key={p.id} photo={p} onStatus={setStatus} onRemove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}