import React, { useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import { PROVIDER_CHAIN } from "@/modules/album/selection/useAiSelection";

// Bloque 3 — consentimiento EXPLÍCITO: sin esto no sale ningún dato del
// dispositivo (verificado también en album-engine: rechaza sin consent:true).
export default function ConsentPanel({ photoCount, estimates, busy, onAccept }) {
  const [save, setSave] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" /> Consentimiento y privacidad
      </h3>
      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">ESTE ANÁLISIS UTILIZA IA REMOTA.</p>
        <p>SE ENVIARÁN PREVIEWS REDUCIDAS (máx. 512 px, SIN EXIF NI GPS, generadas localmente) DE ALGUNAS FOTOGRAFÍAS.</p>
        <p>LOS ARCHIVOS ORIGINALES NUNCA SE ENVIARÁN. NADA SE SUBE A NINGÚN ALMACENAMIENTO: las miniaturas viajan inline y se descartan.</p>
        <p>
          Volumen estimado para {photoCount} fotos: ≈ {estimates.calls} llamadas · ≈ {estimates.mb} MB en total ·
          cadena de proveedores: {PROVIDER_CHAIN.join(" → ")} (Gemini de pago, con Qwen y NVIDIA como respaldo).
        </p>
        <p>Puedes cancelar en cualquier momento, reanudar donde lo dejaste y revocar el consentimiento cuando quieras.</p>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        Guardar consentimiento permanente (revocable). Si no, se pedirá en cada ejecución.
      </label>
      <button
        onClick={() => onAccept({ save })}
        disabled={busy}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
      >
        <Sparkles className="h-4 w-4" /> Autorizar y analizar
      </button>
    </div>
  );
}