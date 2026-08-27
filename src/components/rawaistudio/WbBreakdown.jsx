// Desglose de Balance de Blancos para el panel de validación (Híbrido + FREE).
// Muestra por foto: As Shot → Δ local → Kelvin final, con confianza y fuente.
import React from "react";

export default function WbBreakdown({ wb }) {
  if (!wb || !wb.asShotKelvin) {
    return (
      <span className="text-[10px] font-mono text-zinc-600">
        WB: As Shot conservado (sin As Shot fiable · RAW propietario)
      </span>
    );
  }
  if (!wb.write) {
    return (
      <span className="text-[10px] font-mono text-zinc-500">
        WB: As Shot {wb.asShotKelvin}K conservado · {wb.confidence}% · {wb.source}
        {wb.reason ? ` · ${wb.reason}` : ""}
      </span>
    );
  }
  const dK = wb.temperatureDelta || 0;
  const dT = wb.tintDelta || 0;
  return (
    <span className="text-[10px] font-mono text-zinc-300">
      WB: As Shot {wb.asShotKelvin}K · Δ{" "}
      <span className={dK > 0 ? "text-amber-400" : "text-sky-400"}>
        {dK > 0 ? "+" : ""}{dK}K
      </span>
      {dT !== 0 && (
        <span className={dT > 0 ? "text-emerald-400" : "text-fuchsia-400"}>
          {" · Tint "}{dT > 0 ? "+" : ""}{dT}
        </span>
      )}
      {" · Final "}<span className="text-amber-300">{wb.finalKelvin}K</span>
      {" · "}{wb.confidence}% · {wb.source}
    </span>
  );
}