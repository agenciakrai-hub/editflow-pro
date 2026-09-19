import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Configuración ANTES de generar (punto 14) — diálogo sencillo y no técnico que
// pide al fotógrafo, antes de ejecutar la Asistencia IA o la regeneración:
//   · Máx. lienzos TOTAL del álbum (punto 5): la IA solo crea el complemento hasta
//     alcanzar el límite. Los bloqueados cuentan.
//   · Fotos por lienzo (máx.): techo de fotos por plantilla. Derivado del catálogo
//     real (máx. 12 en T23 = 4×3), no limitado artificialmente a 8 (punto 13).
//   · Prioridad de reparto: más fotos por lienzo / más espacio por foto / equilibrado.
export default function AutoLayoutConfigDialog({ open, defaults, onConfirm, onClose }) {
  const [maxSpreads, setMaxSpreads] = useState(defaults?.maxSpreads ?? 20);
  const [maxPerSpread, setMaxPerSpread] = useState(defaults?.maxPerSpread ?? 6);
  const [priority, setPriority] = useState(defaults?.priority ?? "balanced");

  useEffect(() => {
    if (open) {
      setMaxSpreads(defaults?.maxSpreads ?? 20);
      setMaxPerSpread(defaults?.maxPerSpread ?? 6);
      setPriority(defaults?.priority ?? "balanced");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Asistencia IA</DialogTitle>
          <DialogDescription>Configura el reparto antes de generar los lienzos. El máximo es TOTAL del álbum: la IA solo crea el complemento. Las fotos se distribuyen sin repetir ninguna.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Máx. lienzos</span>
              <input type="number" min="1" max="200" value={maxSpreads}
                onChange={(e) => setMaxSpreads(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Fotos por lienzo (máx.)</span>
              <input type="number" min="1" max="12" value={maxPerSpread}
                onChange={(e) => setMaxPerSpread(Math.min(12, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums" />
            </label>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground">Prioridad de reparto</span>
            <div className="mt-1.5 space-y-1.5">
              {[
                { value: "balanced", label: "Equilibrado", hint: "Reparto uniforme entre cantidad de fotos y espacio." },
                { value: "morePhotos", label: "Más fotos por lienzo", hint: "Aprovecha cada lienzo con más fotos (tiende a menos lienzos)." },
                { value: "moreSpace", label: "Más espacio por foto", hint: "Fotos más grandes y despejadas (tiende a más lienzos)." },
              ].map((p) => (
                <label key={p.value} className={"flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm " + (priority === p.value ? "border-primary bg-secondary" : "border-border hover:bg-secondary")}>
                  <input type="radio" name="al-priority" checked={priority === p.value} onChange={() => setPriority(p.value)} className="mt-0.5 accent-foreground" />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm({ maxSpreads, maxPerSpread, priority })}>Analizar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}