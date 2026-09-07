import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Expand, FileDown, Frame, Redo2, Save, Sparkles, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { albumSizeLabel, STATUS_LABEL } from "@/modules/album/lib/albumUnits";

// Fase 5.2 — Topbar profesional: identidad del álbum, guardado, historial, zoom,
// guías y acciones primarias en una sola barra compacta.
const GUIDE_DEFS = [["bleed", "Sangrado"], ["margins", "Márgenes"], ["safe", "Zona segura"], ["gutter", "Gutter"]];

export default function EditorTopbar({ album, saving, canUndo, canRedo, onUndo, onRedo, zoomPct, onZoom, onFit, guides, onToggleGuide, onDownload, onExport, fillPhotos, onToggleFillPhotos, fillDisabled, canvasFill, onToggleCanvasFill, canvasFillDisabled }) {
  const iconBtn = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-secondary disabled:opacity-40";
  return (
    <header className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <Link to="/album" className={iconBtn} title="Volver a álbumes"><ArrowLeft className="h-4 w-4" /></Link>
      <div className="mr-2 min-w-0">
        <h1 className="truncate text-sm font-semibold leading-tight">{album.name}</h1>
        <p className="truncate text-[11px] text-muted-foreground">
          {albumSizeLabel(album)} · {STATUS_LABEL[album.status] || album.status}
          {album.source_folder_name ? ` · ${album.source_folder_name}` : ""}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className={"text-[11px] font-medium " + (saving ? "animate-pulse text-muted-foreground" : "text-emerald-600")}>
          {saving ? "Guardando…" : "Guardado"}
        </span>
        <div className="flex items-center gap-1">
          <button className={iconBtn} onClick={onUndo} disabled={!canUndo} title="Deshacer"><Undo2 className="h-4 w-4" /></button>
          <button className={iconBtn} onClick={onRedo} disabled={!canRedo} title="Rehacer"><Redo2 className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border px-1.5 py-1 text-[11px]">
          <button className="rounded p-0.5 hover:bg-secondary disabled:opacity-40" onClick={() => onZoom(-25)} disabled={zoomPct <= 25} title="Alejar"><ZoomOut className="h-3.5 w-3.5" /></button>
          <button className="min-w-10 text-center font-medium tabular-nums hover:underline" onClick={onFit} title="Ajustar a 100%">{zoomPct}%</button>
          <button className="rounded p-0.5 hover:bg-secondary disabled:opacity-40" onClick={() => onZoom(25)} disabled={zoomPct >= 400} title="Acercar"><ZoomIn className="h-3.5 w-3.5" /></button>
        </div>
        <div className="hidden items-center gap-2 rounded-lg border border-border px-2 py-1 text-[11px] lg:flex">
          <span className="font-medium text-muted-foreground">Guías</span>
          {GUIDE_DEFS.map(([k, label]) => (
            <label key={k} className="inline-flex cursor-pointer items-center gap-1" title={`Guía: ${label}`}>
              <input type="checkbox" checked={guides[k]} onChange={(e) => onToggleGuide(k, e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
        <button onClick={onToggleCanvasFill} disabled={canvasFillDisabled} aria-pressed={!!canvasFill}
          title={canvasFill
            ? "Relleno completo del lienzo: ON (solo este lienzo). La plantilla ocupa todo el lienzo respetando la separación entre fotografías. Clic para volver a la geometría original de la plantilla."
            : "Hace que la plantilla del lienzo actual ocupe todo el espacio disponible, respetando la separación entre fotografías. Clic para activarlo."}
          className={"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium disabled:opacity-40 " + (canvasFill ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary")}>
          <Expand className="h-3.5 w-3.5" /> Relleno completo del lienzo
          <span className={"rounded px-1 text-[9px] font-bold " + (canvasFill ? "bg-primary-foreground/15" : "bg-secondary")}>{canvasFill ? "ON" : "OFF"}</span>
        </button>
        <button onClick={onToggleFillPhotos} disabled={fillDisabled} aria-pressed={!!fillPhotos}
          title={fillPhotos
            ? "Rellenar contenedor: ON (solo este lienzo). Las fotos cubren su contenedor priorizando las caras detectadas. Clic para volver a foto completa (FIT)."
            : "Rellenar contenedor: OFF (solo este lienzo). Clic para que las fotos cubran su contenedor (COVER) priorizando las caras detectadas."}
          className={"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium disabled:opacity-40 " + (fillPhotos ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary")}>
          <Frame className="h-3.5 w-3.5" /> Rellenar contenedor
          <span className={"rounded px-1 text-[9px] font-bold " + (fillPhotos ? "bg-primary-foreground/15" : "bg-secondary")}>{fillPhotos ? "ON" : "OFF"}</span>
        </button>
        <button onClick={onExport} title="Exportar lienzos (impresión o revisión manual)"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium hover:bg-secondary">
          <FileDown className="h-3.5 w-3.5" /> Exportar
        </button>
        <button onClick={onDownload} title="Guardar proyecto (⌘S / Ctrl+S)"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90">
          <Save className="h-3.5 w-3.5" /> Guardar
        </button>
        <Link to={`/album?project=${album.id}&view=seleccion`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium hover:bg-secondary">
          <Sparkles className="h-3.5 w-3.5" /> Selección IA
        </Link>
      </div>
    </header>
  );
}