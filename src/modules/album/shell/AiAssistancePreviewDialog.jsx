import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, CheckCircle2, AlertTriangle, Images, Layers, Ban } from "lucide-react";

// Punto 9 — PREVISUALIZACIÓN de la propuesta de Asistencia IA antes de aplicar.
// Muestra el resumen del plan: fotos analizadas, propuestas, descartadas por
// similitud, lienzos actuales / máximo / nuevos / total final. El fotógrafo
// revisa y decide: Aplicar (operación atómica, ⌘Z deshace todo) o Cancelar.
export default function AiAssistancePreviewDialog({ open, summary, onApply, onCancel, applying }) {
  if (!summary) return null;
  const maxReached = summary.maxSpreads != null && summary.currentSpreads >= summary.maxSpreads;
  const noPhotos = summary.placed === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !applying && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Asistencia IA
          </DialogTitle>
          <DialogDescription>
            Revisa la propuesta antes de aplicarla. Al aceptar, la maquetación se aplica en una sola operación (⌘Z la deshace completa).
          </DialogDescription>
        </DialogHeader>

        {maxReached ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              El álbum ya tiene {summary.currentSpreads} lienzos y el máximo configurado es {summary.maxSpreads}.
              No se pueden crear lienzos adicionales. Sube el máximo o elimina lienzos existentes.
            </span>
          </div>
        ) : noPhotos ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>No hay fotos nuevas para colocar. Todas las seleccionadas ya están en el álbum o no hay plantillas compatibles.</span>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Images} label="Fotografías analizadas" value={summary.analyzed} />
              <Stat icon={CheckCircle2} label="Fotografías propuestas" value={summary.placed} accent="green" />
              <Stat icon={Ban} label="Descartadas por similitud" value={summary.discardedBySim} accent={summary.discardedBySim > 0 ? "amber" : null} />
              <Stat icon={Images} label="Sin colocar" value={summary.leftover} accent={summary.leftover > 0 ? "amber" : null} />
            </div>
            <div className="h-px bg-border" />
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Layers} label="Lienzos actuales" value={summary.currentSpreads} />
              <Stat icon={Layers} label="Máximo configurado" value={summary.maxSpreads ?? "—"} />
              <Stat icon={Layers} label="Lienzos nuevos" value={summary.newSpreads} accent="green" />
              <Stat icon={Layers} label="Total final" value={summary.finalSpreads} accent={summary.finalSpreads === summary.maxSpreads ? "green" : null} />
            </div>
            {summary.usedAi && (
              <p className="text-[11px] text-muted-foreground">
                Mejora visual IA activa: perfiles de importancia, caras y punto focal aplicados al planificador.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={applying}>Cancelar</Button>
          <Button onClick={onApply} disabled={applying || maxReached || noPhotos}>
            {applying ? "Aplicando…" : "Aplicar propuesta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon: Icon, label, value, accent }) {
  const color = accent === "green" ? "text-emerald-600" : accent === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2">
      <Icon className={"h-4 w-4 shrink-0 " + color} />
      <div className="min-w-0">
        <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
        <p className={"text-lg font-bold tabular-nums leading-tight " + color}>{value}</p>
      </div>
    </div>
  );
}