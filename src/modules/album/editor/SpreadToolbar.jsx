import React from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Copy, Lock, Plus, Trash2, Unlock } from "lucide-react";

// Barra de acciones sobre el spread actual: navegar, crear, duplicar, mover y bloquear.
export default function SpreadToolbar({ index, total, hasSpread, locked, onPrev, onNext, onAdd, onDuplicate, onDelete, onMoveLeft, onMoveRight, onToggleLock }) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn} onClick={onPrev} disabled={!hasSpread || index <= 0}><ChevronLeft className="h-3.5 w-3.5" /> Anterior</button>
      <span className="min-w-24 text-center text-xs tabular-nums text-muted-foreground">
        {hasSpread ? `Spread ${index + 1} / ${total}` : "Sin spreads"}
      </span>
      <button className={btn} onClick={onNext} disabled={!hasSpread || index >= total - 1}>Siguiente <ChevronRight className="h-3.5 w-3.5" /></button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button className={btn} onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Nuevo</button>
        <button className={btn} onClick={onDuplicate} disabled={!hasSpread}><Copy className="h-3.5 w-3.5" /> Duplicar</button>
        <button className={btn} onClick={onMoveLeft} disabled={!hasSpread || index <= 0}><ArrowLeft className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={onMoveRight} disabled={!hasSpread || index >= total - 1}><ArrowRight className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={onToggleLock} disabled={!hasSpread}>
          {locked ? <><Unlock className="h-3.5 w-3.5" /> Desbloquear</> : <><Lock className="h-3.5 w-3.5" /> Bloquear</>}
        </button>
        <button className={btn + " text-destructive hover:bg-destructive/10"} onClick={onDelete} disabled={!hasSpread}>
          <Trash2 className="h-3.5 w-3.5" /> Eliminar
        </button>
      </div>
    </div>
  );
}