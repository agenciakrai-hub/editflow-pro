import React, { useRef } from "react";
import { Copy, Lock, Plus, Trash2 } from "lucide-react";

// Vista general del álbum (wireframe D): miniaturas de todos los spreads, reordenar
// arrastrando, duplicar/eliminar al vuelo y crear nuevos spreads.
export default function AlbumOverview({ album, spreads, selectedId, onSelect, onAdd, onDuplicate, onDelete, onReorder }) {
  const W = album.width_mm;
  const H = album.height_mm;
  const cardW = 96;
  const cardH = Math.max(40, Math.round((cardW * H) / W));
  const dragId = useRef(null);

  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-border bg-card p-2">
      {spreads.map((s, i) => {
        const count = (s.slots || []).filter((x) => x.photo_id).length;
        return (
          <div key={s.id} draggable
            onDragStart={() => { dragId.current = s.id; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId.current && dragId.current !== s.id) onReorder(dragId.current, s.id);
              dragId.current = null;
            }}
            onClick={() => onSelect(s.id)}
            className={"group relative shrink-0 cursor-pointer rounded-lg border p-1 " + (s.id === selectedId ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30")}>
            <div className="relative bg-neutral-200" style={{ width: cardW, height: cardH }}>
              {(s.slots || []).map((sl) => (
                <div key={sl.slot_id}
                  className={"absolute rounded-[1px] " + (sl.photo_id ? "bg-primary/60" : "border border-dashed border-neutral-400")}
                  style={{ left: `${(sl.x_mm / W) * 100}%`, top: `${(sl.y_mm / H) * 100}%`, width: `${(sl.w_mm / W) * 100}%`, height: `${(sl.h_mm / H) * 100}%` }} />
              ))}
              {s.locked && <Lock className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-neutral-700" />}
            </div>
            <div className="flex items-center justify-between px-0.5 pt-1 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground">{i + 1}</span>
              <span>{count} foto{count === 1 ? "" : "s"}</span>
            </div>
            <div className="absolute -top-1.5 right-1.5 hidden gap-1 group-hover:flex">
              <button title="Duplicar" onClick={(e) => { e.stopPropagation(); onDuplicate(s.id); }}
                className="rounded bg-primary p-1 text-primary-foreground shadow"><Copy className="h-3 w-3" /></button>
              <button title="Eliminar" onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                className="rounded bg-destructive p-1 text-destructive-foreground shadow"><Trash2 className="h-3 w-3" /></button>
            </div>
          </div>
        );
      })}
      <button onClick={onAdd}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-border px-3 text-xs font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground"
        style={{ height: cardH + 14 }}>
        <Plus className="h-3.5 w-3.5" /> Spread
      </button>
    </div>
  );
}