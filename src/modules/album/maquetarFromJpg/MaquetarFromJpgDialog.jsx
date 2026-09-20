// MAQUETAR DESDE JPG — Diálogo para seleccionar la carpeta de JPG editados,
// leer sus metadatos XMP, mostrar el resumen de clasificación y maquetar.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FolderOpen, Loader2, Star, AlertCircle } from "lucide-react";
import { classifyJpgFolder } from "@/modules/album/maquetarFromJpg/folderClassifier";
import { CLASSIFICATION } from "@/modules/album/xmp/classificationMapper";

export default function MaquetarFromJpgDialog({ open, onClose, projectPhotos, onMaquetar }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSelectFolder = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await classifyJpgFolder(projectPhotos);
      setResult(res);
    } catch (e) {
      if (e?.name !== "AbortError") setError(e?.message || "No se pudo leer la carpeta.");
    } finally {
      setLoading(false);
    }
  };

  const handleMaquetar = () => {
    if (!result?.maquetableIds?.length) return;
    onMaquetar(result.maquetableIds, result.roleOf);
    handleClose();
  };

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  const s = result?.summary;
  const hasSelection = (s?.[CLASSIFICATION.TOP] || 0) + (s?.[CLASSIFICATION.VALID] || 0) > 0;
  const hasUnclassified = (s?.[CLASSIFICATION.UNCLASSIFIED] || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Maquetar desde JPG editados</DialogTitle>
          <DialogDescription>
            Selecciona la carpeta donde tienes guardados los JPG editados del proyecto.
            EditFlow leerá sus metadatos XMP para recuperar la selección realizada anteriormente por IA.
          </DialogDescription>
        </DialogHeader>

        {!result && !loading && (
          <div className="py-6 text-center">
            <Button onClick={handleSelectFolder} variant="outline" className="gap-2">
              <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
            </Button>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </div>
        )}

        {loading && (
          <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Leyendo metadatos XMP de los JPG…</span>
          </div>
        )}

        {result && s && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Carpeta: <span className="font-medium text-foreground">{result.folderName}</span> · {s.total} fotografías
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryRow icon="★" color="text-green-600" label="TOP" count={s[CLASSIFICATION.TOP]} sub="★★★★★ + Verde" />
              <SummaryRow icon="★" color="text-green-600" label="VÁLIDAS" count={s[CLASSIFICATION.VALID]} sub="★★★★ + Verde" />
              <SummaryRow icon="●" color="text-yellow-500" label="REVISAR" count={s[CLASSIFICATION.REVIEW]} sub="Amarillo" />
              <SummaryRow icon="○" color="text-muted-foreground" label="SIN CLASIFICAR" count={s[CLASSIFICATION.UNCLASSIFIED]} sub="Sin XMP" />
            </div>

            <div className="rounded-lg border bg-muted/50 px-3 py-2 text-sm">
              <span className="font-medium">Fotografías disponibles para maquetación: </span>
              <span className="text-primary font-semibold">{(s[CLASSIFICATION.TOP] || 0) + (s[CLASSIFICATION.VALID] || 0)}</span>
              <span className="text-muted-foreground"> (TOP + VÁLIDAS)</span>
            </div>

            {hasUnclassified && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" />
                <div>
                  <p className="font-medium">Hay {s[CLASSIFICATION.UNCLASSIFIED]} fotografía(s) sin analizar.</p>
                  <p className="text-muted-foreground">No se enviarán a IA automáticamente. Puedes maquetar con la selección disponible o analizarlas desde Selección IA.</p>
                </div>
              </div>
            )}

            {s.unmatched > 0 && (
              <p className="text-xs text-muted-foreground">
                {s.unmatched} JPG(s) no coinciden con fotos del proyecto (nombre distinto).
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleClose}>Cancelar</Button>
          {result && (
            <>
              <Button variant="outline" onClick={handleSelectFolder} className="gap-2">
                <FolderOpen className="h-3.5 w-3.5" /> Otra carpeta
              </Button>
              <Button onClick={handleMaquetar} disabled={!hasSelection}>
                Maquetar ({(s?.[CLASSIFICATION.TOP] || 0) + (s?.[CLASSIFICATION.VALID] || 0)})
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ icon, color, label, count, sub }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <span className={`text-lg ${color}`}>{icon}</span>
      <div className="flex-1">
        <div className="font-medium leading-tight">{count} · {label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}