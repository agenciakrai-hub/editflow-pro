import { useMemo, useState } from "react";
import { FolderOpen, Loader2, Package, FileDown, RotateCcw, FlaskConical } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { analyzePhotometrics } from "@/lib/rawaistudio/photometricAnalysis";
import { computeFreeBaseline } from "@/lib/rawaistudio/exposureEngine";
import { patchXmpAttributes } from "@/lib/rawaistudio/xmpTagPatcher";

// PRUEBA CONTROLADA del modo "Ajustes automáticos — GRATIS".
// Ejecuta EXCLUSIVAMENTE: extractPreviews → analyzePhotometrics → computeFreeBaseline → XMP.
// Sin Qwen, sin InvokeLLM, sin aiGateway, sin UploadFile, sin APIs externas, sin créditos.
// Muestra por foto las métricas y los valores XMP calculados, y permite descargar ZIP + CSV.
const DEFAULT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"/>
  </rdf:RDF>
</x:xmpmeta>`;

const HEADERS = [
  "filename", "p1", "p5", "p25", "p50", "p75", "p95", "p99",
  "clipHighlightPct", "clipShadowPct",
  "Exposure2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012", "Contrast2012", "confidence",
];

function toCsv(rows) {
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push([
      `"${r.filename}"`,
      r.stats.p1, r.stats.p5, r.stats.p25, r.stats.p50, r.stats.p75, r.stats.p95, r.stats.p99,
      r.stats.clipHighlightPct, r.stats.clipShadowPct,
      r.values.Exposure2012, r.values.Highlights2012, r.values.Shadows2012, r.values.Whites2012, r.values.Blacks2012, r.values.Contrast2012,
      r.confidence,
    ].join(","));
  }
  return lines.join("\n");
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const COLS = [
  { key: "Exposure2012", label: "Exposure" },
  { key: "Highlights2012", label: "Highlights" },
  { key: "Shadows2012", label: "Shadows" },
  { key: "Whites2012", label: "Whites" },
  { key: "Blacks2012", label: "Blacks" },
  { key: "Contrast2012", label: "Contrast" },
];

export default function PruebaGratis() {
  const [stage, setStage] = useState("idle"); // idle | extracting | analyzing | done
  const [extDone, setExtDone] = useState(0);
  const [extTotal, setExtTotal] = useState(0);
  const [anaDone, setAnaDone] = useState(0);
  const [rows, setRows] = useState([]);
  const [xmps, setXmps] = useState([]);
  const [error, setError] = useState(null);
  const [zipping, setZipping] = useState(false);

  const onPick = (list) => {
    const raws = Array.from(list || []).filter((f) => isRawFile(f.name) && !isHiddenOrSystemFile(f.name));
    if (!raws.length) { setError("No se encontraron archivos RAW en la selección."); return; }
    setError(null);
    setRows([]); setXmps([]);
    run(raws);
  };

  const run = async (raws) => {
    setStage("extracting");
    setExtTotal(raws.length); setExtDone(0);
    const items = raws.map((f, i) => ({ id: String(i), file: f }));
    const withPreview = await extractPreviews(items, (d) => setExtDone(d));

    setStage("analyzing");
    setAnaDone(0);
    const out = [];
    const xmpOut = [];
    for (let i = 0; i < withPreview.length; i++) {
      const p = withPreview[i];
      const base64 = p.preview?.base64;
      const stats = base64 ? await analyzePhotometrics(base64) : null;
      const free = stats ? computeFreeBaseline(stats, "balanced") : null;
      const values = free?.values || {};
      let xmp = DEFAULT_TEMPLATE;
      xmp = patchXmpAttributes(xmp, values);
      out.push({ filename: p.file.name, stats: stats || {}, values, confidence: free?.confidence ?? null });
      xmpOut.push({ filename: p.file.name, xmp_content: xmp });
      setAnaDone(i + 1);
    }
    setRows(out);
    setXmps(xmpOut);
    setStage("done");
  };

  const downloadZip = async () => {
    if (!xmps.length) return;
    setZipping(true);
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "zip-xmp", jobs: xmps });
      const url = res?.data?.downloadUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url; a.download = "EditFlowPro-PruebaGRATIS.zip";
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) { setError(e?.message || "Error al generar el ZIP"); }
    setZipping(false);
  };

  const downloadCsv = () => {
    if (!rows.length) return;
    downloadText("prueba-gratis-informe.csv", toCsv(rows), "text/csv;charset=utf-8");
  };

  const downloadJson = () => {
    if (!rows.length) return;
    downloadText("prueba-gratis-informe.json", JSON.stringify(rows, null, 2), "application/json");
  };

  const reset = () => { setStage("idle"); setRows([]); setXmps([]); setError(null); setExtDone(0); setAnaDone(0); setExtTotal(0); };

  const busy = stage === "extracting" || stage === "analyzing";

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const nonzero = rows.filter((r) => Object.values(r.values).some((v) => v !== 0)).length;
    return { total: rows.length, nonzero };
  }, [rows]);

  return (
    <div className="min-h-[calc(100vh-4rem)] rounded-xl bg-[#0a0a0a] p-4 sm:p-6 text-zinc-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500 flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Prueba controlada</p>
          <h1 className="mt-1 text-2xl font-semibold">Modo GRATIS — validación fotométrica</h1>
          <p className="mt-1 text-xs text-zinc-500">
            Pipeline determinista: extractPreviews → analyzePhotometrics → computeFreeBaseline → XMP. Sin IA, sin créditos, sin red.
          </p>
        </div>
        {stage === "done" && (
          <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
            <RotateCcw className="h-3.5 w-3.5" /> Otra carpeta
          </button>
        )}
      </div>

      {stage === "idle" && (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-700 bg-[#141414] p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-zinc-500" />
          <p className="mt-3 text-sm text-zinc-400">Carga los RAW de las situaciones a probar (nombra cada archivo por su situación: 01_correcta, 02_subexpuesta…)</p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
            <FolderOpen className="h-4 w-4" /> Seleccionar carpeta
            <input type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={(e) => onPick(e.target.files)} />
          </label>
          <label className="mt-2 block text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
            o selecciona archivos sueltos
            <input type="file" className="hidden" multiple onChange={(e) => onPick(e.target.files)} />
          </label>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}

      {busy && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-[#141414] p-6">
          <p className="text-sm font-medium">
            {stage === "extracting" ? `Leyendo previews embebidas (${extDone}/${extTotal})` : `Calculando ajustes deterministas (${anaDone}/${extTotal})`}
          </p>
          <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procesando…
          </p>
        </div>
      )}

      {stage === "done" && (
        <div className="mt-6 space-y-4">
          {summary && (
            <p className="text-xs text-emerald-400">
              {summary.total} fotos · {summary.nonzero} con ajuste ≠ 0 · resto correctamente sin tocar (no sobre-ajusta).
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button onClick={downloadZip} disabled={zipping}
              className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">
              {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />} Descargar ZIP XMP
            </button>
            <button onClick={downloadCsv}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
              <FileDown className="h-4 w-4" /> Informe CSV
            </button>
            <button onClick={downloadJson}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">
              <FileDown className="h-4 w-4" /> Informe JSON
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#141414]">
            <table className="min-w-full text-xs">
              <thead className="bg-[#1a1a1a] text-zinc-400">
                <tr>
                  <th className="px-2 py-2 text-left sticky left-0 bg-[#1a1a1a]">filename</th>
                  {["p1","p5","p25","p50","p75","p95","p99","clipH%","clipS%"].map((h) => (
                    <th key={h} className="px-2 py-2 text-right">{h}</th>
                  ))}
                  {COLS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right">{c.label}</th>
                  ))}
                  <th className="px-2 py-2 text-right">conf</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map((r) => (
                  <tr key={r.filename} className="hover:bg-zinc-900/50">
                    <td className="px-2 py-2 text-left sticky left-0 bg-[#141414] text-zinc-200">{r.filename}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p1 ?? "-"}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p5 ?? "-"}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p25 ?? "-"}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p50 ?? "-"}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p75 ?? "-"}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p95 ?? "-"}</td>
                    <td className="px-2 py-2 text-right text-zinc-400">{r.stats.p99 ?? "-"}</td>
                    <td className={`px-2 py-2 text-right ${r.stats.clipHighlightPct > 0.03 ? "text-red-400" : "text-zinc-400"}`}>{r.stats.clipHighlightPct != null ? (r.stats.clipHighlightPct * 100).toFixed(2) : "-"}</td>
                    <td className={`px-2 py-2 text-right ${r.stats.clipShadowPct > 0.03 ? "text-red-400" : "text-zinc-400"}`}>{r.stats.clipShadowPct != null ? (r.stats.clipShadowPct * 100).toFixed(2) : "-"}</td>
                    {COLS.map((c) => {
                      const v = r.values[c.key] ?? 0;
                      const cls = v === 0 ? "text-zinc-500" : v > 0 ? "text-emerald-400" : "text-sky-400";
                      return <td key={c.key} className={`px-2 py-2 text-right ${cls}`}>{v}</td>;
                    })}
                    <td className="px-2 py-2 text-right text-zinc-400">{r.confidence ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Verde = ajuste positivo · azul = negativo · gris = 0 (sin tocar). Rojo en clipH/clipS = clipping severo (&gt;3%).
          </p>
        </div>
      )}
    </div>
  );
}