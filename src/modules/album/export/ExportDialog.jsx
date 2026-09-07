import React, { useMemo, useState } from "react";
import { FileDown, FolderOpen, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { exportSpreads, pickExportFolder, supportsFolderExport } from "@/modules/album/export/exportSpreads";
import { albumSizeLabel } from "@/modules/album/lib/albumUnits";
import { putFolderHandle } from "@/modules/album/lib/previewStore";

// Fase Exportación — modal con las DOS opciones principales: PARA IMPRESIÓN y
// REVISIÓN MANUAL. Habla siempre de LIENZOS. Lee el proyecto sin modificarlo y
// renderiza con el motor único (spreadRenderer). Nunca duplica lógica de layout.
const labelCls = "text-xs font-medium text-foreground";
const noteCls = "text-[11px] text-muted-foreground";
const inputCls = "h-8 w-24 rounded-md border border-input bg-transparent px-2 text-xs";
const checkRow = "flex cursor-pointer items-center gap-2 text-xs";

function Field({ label, children, note }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={labelCls}>{label}</span>
      {children}
      {note && <span className={noteCls}>{note}</span>}
    </div>
  );
}

export default function ExportDialog({ album, spreads, photosById, onClose }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("print");
  const total = spreads.length;

  const [folder, setFolder] = useState(null);
  const [format, setFormat] = useState("jpeg");
  const [quality, setQuality] = useState(92);
  const [rangeMode, setRangeMode] = useState("all");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(total || 1);

  // Para impresión
  const [dpi, setDpi] = useState(album.dpi || 300);
  const [includeBleed, setIncludeBleed] = useState(true);

  // Revisión manual
  const [maxEdge, setMaxEdge] = useState(1600);
  const [ovLienzo, setOvLienzo] = useState(true);
  const [ovNumbers, setOvNumbers] = useState(false);
  const [ovFilenames, setOvFilenames] = useState(false);
  const [ovSpine, setOvSpine] = useState(false);
  const [ovCut, setOvCut] = useState(false);
  const [ovWatermark, setOvWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState("REVISIÓN");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const canExport = useMemo(() => {
    if (running || !total) return false;
    if (rangeMode === "range") return from >= 1 && to >= from && from <= total;
    return true;
  }, [running, total, rangeMode, from, to]);

  const chooseFolder = async () => {
    const h = await pickExportFolder();
    if (h) setFolder(h);
  };

  // Para impresión — re-vincular la CARPETA DE ORIGINALES cuando la exportación se
  // detiene por archivos originales no disponibles (nunca se sustituyen por previews).
  const linkOriginalFolder = async () => {
    if (typeof window.showDirectoryPicker !== "function") return;
    try {
      const h = await window.showDirectoryPicker({ mode: "readwrite" });
      await putFolderHandle(album.id, h);
      toast({ title: "Carpeta original vinculada", description: "Pulsa «Exportar» de nuevo para reintentar." });
    } catch {}
  };

  const handleExport = async () => {
    setRunning(true);
    setResult(null);
    setProgress(null);
    try {
      const selected =
        rangeMode === "all"
          ? spreads
          : spreads.slice(Math.max(0, from - 1), Math.min(total, to));
      const pxPerMm =
        tab === "print"
          ? dpi / 25.4
          : maxEdge / Math.max(album.width_mm, album.height_mm);
      const res = await exportSpreads({
        album,
        spreads: selected,
        photosById,
        options: {
          folderHandle: folder,
          format,
          quality: quality / 100,
          pxPerMm,
          includeBleed: tab === "print" && includeBleed,
          checkResolution: tab === "print",
          requireOriginals: tab === "print",
          overlays:
            tab === "review"
              ? {
                  lienzoNumber: ovLienzo,
                  imageNumbers: ovNumbers,
                  filenames: ovFilenames,
                  spineLine: ovSpine,
                  cutMarks: ovCut,
                  watermark: ovWatermark ? watermarkText : null,
                }
              : null,
        },
        onProgress: (done, t, name) => setProgress({ done, t, name }),
      });
      setResult(res);
      if (res.blocked) {
        toast({
          title: "Exportación detenida",
          description: `Faltan ${res.missingOriginals.length} archivo(s) original(es). Para impresión no se usan previews.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Exportación completa",
          description:
            `${res.count} lienzo(s) exportado(s) a ${folder ? `«${folder.name}»` : "tu equipo"}` +
            (res.missing ? ` · ${res.missing} foto(s) sin preview en este dispositivo` : ""),
        });
      }
    } catch (e) {
      toast({ title: "No se pudo completar la exportación", description: e?.message, variant: "destructive" });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const tabBtn = (id, txt) =>
    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors " +
    (tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground");

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !running) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Exportar lienzos</DialogTitle>
          <p className={noteCls}>{album.name} · {albumSizeLabel(album)} · {total} lienzo(s)</p>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
          <button className={tabBtn("print")} onClick={() => setTab("print")}>Para impresión</button>
          <button className={tabBtn("review")} onClick={() => setTab("review")}>Revisión manual</button>
        </div>

        <div className="space-y-3">
          {/* --- Común: destino, formato, calidad, rango --- */}
          <Field label="Carpeta de destino">
            <button
              onClick={chooseFolder}
              disabled={!supportsFolderExport()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="h-3.5 w-3.5" /> {folder ? folder.name : "Elegir carpeta…"}
            </button>
            {!supportsFolderExport() && <span className={noteCls}>Los archivos se descargarán al equipo</span>}
          </Field>

          <Field label="Formato de salida">
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={inputCls}>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
            </select>
            {format === "jpeg" && (
              <>
                <span className={noteCls}>Calidad</span>
                <input type="number" min={50} max={100} value={quality}
                  onChange={(e) => setQuality(Math.min(100, Math.max(50, Number(e.target.value) || 92)))}
                  className={inputCls} />
                <span className={noteCls}>%</span>
              </>
            )}
          </Field>

          <Field label="Lienzos a exportar">
            <label className={checkRow}>
              <input type="radio" checked={rangeMode === "all"} onChange={() => setRangeMode("all")} />
              Todos los lienzos ({total})
            </label>
            <label className={checkRow}>
              <input type="radio" checked={rangeMode === "range"} onChange={() => setRangeMode("range")} />
              Rango
            </label>
            {rangeMode === "range" && (
              <>
                <input type="number" min={1} max={total} value={from}
                  onChange={(e) => setFrom(Math.min(total, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />
                <span className={noteCls}>a</span>
                <input type="number" min={1} max={total} value={to}
                  onChange={(e) => setTo(Math.min(total, Math.max(1, Number(e.target.value) || 1)))} className={inputCls} />
              </>
            )}
          </Field>

          {/* --- Para impresión --- */}
          {tab === "print" ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className={noteCls}>Lienzos finales preparados para imprenta: resolución física real y sangrado.</p>
              <Field label="Resolución">
                <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className={inputCls}>
                  <option value={150}>150 DPI</option>
                  <option value={300}>300 DPI</option>
                  <option value={600}>600 DPI</option>
                </select>
                <span className={noteCls}>
                  ≈ {Math.round(album.width_mm * dpi / 25.4)} × {Math.round(album.height_mm * dpi / 25.4)} px por lienzo
                </span>
              </Field>
              <label className={checkRow}>
                <input type="checkbox" checked={includeBleed} onChange={(e) => setIncludeBleed(e.target.checked)} />
                Incluir sangrado ({album.bleed_mm ?? 3} mm por lado)
              </label>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className={noteCls}>Lienzos para revisar con el cliente: elementos de revisión sobreimpresos.</p>
              <Field label="Dimensión de salida">
                <select value={maxEdge} onChange={(e) => setMaxEdge(Number(e.target.value))} className={inputCls}>
                  <option value={1200}>1200 px</option>
                  <option value={1600}>1600 px</option>
                  <option value={2400}>2400 px</option>
                </select>
                <span className={noteCls}>lado mayor del lienzo</span>
              </Field>
              <label className={checkRow}>
                <input type="checkbox" checked={ovLienzo} onChange={(e) => setOvLienzo(e.target.checked)} />
                Numeración de lienzos
              </label>
              <label className={checkRow}>
                <input type="checkbox" checked={ovNumbers} onChange={(e) => setOvNumbers(e.target.checked)} />
                Numeración de imágenes
              </label>
              <label className={checkRow}>
                <input type="checkbox" checked={ovFilenames} onChange={(e) => setOvFilenames(e.target.checked)} />
                Nombre de archivo de las imágenes
              </label>
              <label className={checkRow}>
                <input type="checkbox" checked={ovSpine} onChange={(e) => setOvSpine(e.target.checked)} />
                Línea de lomo
              </label>
              <label className={checkRow}>
                <input type="checkbox" checked={ovCut} onChange={(e) => setOvCut(e.target.checked)} />
                Área de corte
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <label className={checkRow}>
                  <input type="checkbox" checked={ovWatermark} onChange={(e) => setOvWatermark(e.target.checked)} />
                  Marca de agua
                </label>
                {ovWatermark && (
                  <input type="text" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)}
                    className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-xs" />
                )}
              </div>
            </div>
          )}
        </div>

        {progress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Exportando {progress.done} de {progress.t}… <span className="truncate">{progress.name}</span>
          </div>
        )}

        {result?.blocked && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <p className="font-semibold">
              Exportación detenida: {result.missingOriginals.length} archivo(s) original(es) no disponible(s).
            </p>
            <p className="mt-1">
              Para impresión se usan exclusivamente los archivos originales (nunca previews). Vincula de
              nuevo la carpeta con los originales y vuelve a exportar.
            </p>
            <p className="mt-1 max-h-24 overflow-y-auto break-words">
              {result.missingOriginals.slice(0, 12).map((x) => x.filename).join(" · ")}
              {result.missingOriginals.length > 12 ? " …" : ""}
            </p>
            <button onClick={linkOriginalFolder}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-destructive/50 px-2.5 py-1.5 font-semibold hover:bg-destructive/20">
              <FolderOpen className="h-3.5 w-3.5" /> Vincular carpeta original
            </button>
          </div>
        )}

        {result && !result.blocked && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-emerald-600">
              {result.count} lienzo(s) exportado(s){result.missing ? ` · ${result.missing} foto(s) sin preview en este dispositivo` : ""}.
            </p>
            {result.fromPreview > 0 && (
              <p className="text-xs text-amber-600">
                ⚠ {result.fromPreview} foto(s) exportadas desde la preview guardada (esto solo ocurre en
                Revisión manual): la carpeta de originales no está disponible en este dispositivo. Para
                impresión, importa o re-vincula la carpeta original antes de exportar.
              </p>
            )}
            {result.lowRes?.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
                <p className="font-semibold">
                  ⚠ {result.lowRes.length} fotografía(s) podrían no tener suficiente resolución para impresión en el tamaño seleccionado.
                </p>
                <p className="mt-1 text-amber-600">
                  {result.lowRes.slice(0, 8).map((x) => `${x.filename} (~${x.dpi} DPI)`).join(" · ")}
                  {result.lowRes.length > 8 ? " …" : ""}
                </p>
                <p className="mt-1 text-amber-600">La exportación continuó igualmente.</p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button onClick={onClose} disabled={running}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50">
            Cerrar
          </button>
          <button onClick={handleExport} disabled={!canExport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Exportar {total ? `${rangeMode === "all" ? total : Math.max(0, Math.min(total, to) - Math.max(0, from - 1))} lienzo(s)` : ""}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}