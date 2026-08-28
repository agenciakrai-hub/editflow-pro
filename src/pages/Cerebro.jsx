import { useState } from "react";
import { Brain } from "lucide-react";
import MisPresets from "@/modules/cerebro/MisPresets";
import MisEstilos from "@/modules/cerebro/MisEstilos";

// Cerebro: memoria del fotógrafo. Dos secciones independientes:
//  - Mis presets: registro permanente y versionado de presets (no los aplica).
//  - Mis estilos: preset base + correcciones reales + aprendizaje acumulado.
// No toca los motores de edición: solo almacena y relaciona información.
export default function Cerebro() {
  const [tab, setTab] = useState("presets");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-accent" />
        <div>
          <h1 className="text-2xl font-semibold">Cerebro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La memoria del fotógrafo: presets registrados, estilos aprendidos e historial de correcciones.
          </p>
        </div>
      </div>

      <div className="flex gap-1 rounded-md bg-secondary p-1 w-fit">
        <button onClick={() => setTab("presets")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${tab === "presets" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>
          Mis presets
        </button>
        <button onClick={() => setTab("estilos")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${tab === "estilos" ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>
          Mis estilos
        </button>
      </div>

      {tab === "presets" ? <MisPresets /> : <MisEstilos />}
    </div>
  );
}