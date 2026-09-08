import React from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Copy, Lock, Plus, RefreshCw, Trash2, Unlock } from "lucide-react";

// Fase 5.2 — Controles del spread actual (franja inferior del centro): navegar,
// crear, duplicar, mover, bloquear y eliminar.
export default function SpreadControls({ index, total, hasSpread, locked, onPrev, onNext, onAdd, onDuplicate, onDelete, onMoveLeft, onMoveRight, onToggleLock, onRegenerate }) {
  const btn = "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium hover:bg-secondary disabled:opacity-40";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5">
      <button className={btn} onClick={onPrev} disabled={!hasSpread || index <= 0} title="Lienzo anterior"><ChevronLeft className="h-3.5 w-3.5" /></button>
      <span className="min-w-20 text-center text-[11px] tabular-nums text-muted-foreground">
        {hasSpread ? `Lienzo ${index + 1} / ${total}` : "Sin lienzos"}
      </span>
      <button className={btn} onClick={onNext} disabled={!hasSpread || index >= total - 1} title="Lienzo siguiente"><ChevronRight className="h-3.5 w-3.5" /></button>
      <div className="mx-1 hidden h-4 w-px bg-border sm:block" />
      <button className={btn} onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Nuevo lienzo</button>
      <button className={btn} onClick={onDuplicate} disabled={!hasSpread}><Copy className="h-3.5 w-3.5" /> Duplicar</button>
      <button className={btn} onClick={onRegenerate} disabled={!hasSpread || locked} title="Vuelve a elegir la mejor plantilla para las fotos de este lienzo (no actúa si está bloqueado)"><RefreshCw className="h-3.5 w-3.5" /> Regenerar</button>
      <button className={btn} onClick={onMoveLeft} disabled={!hasSpread || index <= 0} title="Mover hacia el principio"><ArrowLeft className="h-3.5 w-3.5" /></button>
      <button className={btn} onClick={onMoveRight} disabled={!hasSpread || index >= total - 1} title="Mover hacia el final"><ArrowRight className="h-3.5 w-3.5" /></button>
      <button className={btn} onClick={onToggleLock} disabled={!hasSpread}>
        {locked ? <><Unlock className="h-3.5 w-3.5" /> Desbloquear</> : <><Lock className="h-3.5 w-3.5" /> Bloquear</>}
      </button>
      <button className={btn + " border-destructive/50 text-destructive hover:bg-destructive/10"} onClick={onDelete} disabled={!hasSpread}>
        <Trash2 className="h-3.5 w-3.5" /> Eliminar
      </button>
    </div>
  );
}