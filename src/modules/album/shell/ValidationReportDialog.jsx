import React from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Punto 15 — informe de la validación final: errores primero (duplicados, límite
// de lienzos), después avisos (similares, calidad de impresión, protagonismo,
// lienzos vacíos) y notas de variedad. Todo revisable y corregible a mano.
const ICONS = { error: AlertTriangle, warning: AlertCircle, info: Info };
const COLORS = { error: "text-destructive", warning: "text-amber-500", info: "text-muted-foreground" };

export default function ValidationReportDialog({ findings, onClose }) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Validación de la maquetación</DialogTitle>
          <DialogDescription>Comprobación automática antes de dar el álbum por terminado: duplicados, fotos similares, calidad de impresión, protagonismo, lienzos vacíos y variedad.</DialogDescription>
        </DialogHeader>
        {findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-3 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Todo correcto: no se han encontrado problemas.
          </div>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {[...errors, ...warnings, ...infos].map((f, i) => {
              const Icon = ICONS[f.severity] || Info;
              return (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-xs">
                  <Icon className={"mt-0.5 h-3.5 w-3.5 shrink-0 " + (COLORS[f.severity] || "")} />
                  <span>{f.message}</span>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <span className="mr-auto text-[11px] text-muted-foreground">{errors.length} error(es) · {warnings.length} aviso(s) · {infos.length} nota(s)</span>
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}