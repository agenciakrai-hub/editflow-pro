function ms(value) {
  return `${Math.round(value || 0)} ms`;
}

export default function PerformanceMetrics({ metrics }) {
  if (!metrics?.totalMs) return null;
  const rows = [
    ["Extracción", metrics.extractionMs],
    ["Piel / neutros", metrics.skinMs],
    ["Fotometría", metrics.photometricMs],
    ["Adaptación Híbrida", metrics.adaptationMs],
    ["XMP", metrics.xmpMs],
    ["ZIP", metrics.zipMs],
    ["Total", metrics.totalMs],
  ];
  return (
    <div className="rounded-md border border-zinc-800 bg-[#141414] p-3">
      <p className="text-xs font-medium text-zinc-300">Rendimiento medido</p>
      <p className="mt-1 text-[10px] text-zinc-500">{metrics.photoCount} fotos procesadas · tiempos acumulados locales salvo ZIP</p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 text-zinc-400">
            <span>{label}</span><span className="text-zinc-200">{ms(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}