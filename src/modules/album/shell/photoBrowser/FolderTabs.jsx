import React from "react";
import { FolderPlus } from "lucide-react";

// Fase Carpetas — pestañas de organización del navegador de fotos: "Todas" + una por
// carpeta con su contador (p. ej. "Pareja (42)"). Arrastrar una foto sobre una pestaña
// la asigna a esa carpeta (soltar sobre "Todas" la quita de su carpeta). Es una
// organización VIRTUAL: los archivos originales nunca se mueven ni duplican.
export default function FolderTabs({ folders, counts, total, active, onSelect, onCreate, onDropPhoto }) {
  const tab = (isActive) =>
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors " +
    (isActive ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground");
  const dropProps = (folder) => ({
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
    onDrop: (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/album-photo");
      if (id) onDropPhoto(id, folder);
    },
  });

  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-hide">
      <button onClick={() => onSelect("__all__")} {...dropProps(null)} className={tab(active === "__all__")}>
        Todas <span className="tabular-nums opacity-70">({total})</span>
      </button>
      {folders.map((f) => (
        <button key={f} onClick={() => onSelect(f)} {...dropProps(f)} className={tab(active === f)} title={f}>
          <span className="max-w-28 truncate">{f}</span> <span className="tabular-nums opacity-70">({counts[f] || 0})</span>
        </button>
      ))}
      <button onClick={onCreate}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground">
        <FolderPlus className="h-3 w-3" /> Nueva carpeta
      </button>
    </div>
  );
}