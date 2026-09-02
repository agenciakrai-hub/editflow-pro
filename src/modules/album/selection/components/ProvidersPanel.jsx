import React, { useState } from "react";
import { Activity, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { runSanitizerSelfTest, makeSyntheticImage } from "@/modules/album/selection/selfTest";
import { sanitizeForAi } from "@/modules/album/selection/sanitizer";

// Diagnóstico (Checkpoints 2, 4, 5, 6, 7) — SOLO imagen SINTÉTICA generada en el
// navegador: nunca fotografías privadas. Muestra la matriz de proveedores y la
// simulación de failover de la cadena propia de Album AI.
export default function ProvidersPanel() {
  const [selfTest, setSelfTest] = useState(null);
  const [providers, setProviders] = useState(null);
  const [failover, setFailover] = useState(null);
  const [busy, setBusy] = useState("");

  const runSelfTest = async () => {
    setBusy("self");
    try {
      setSelfTest(await runSanitizerSelfTest());
    } catch (e) {
      setSelfTest({ ok: false, checks: [{ name: "error", ok: false, detail: String(e?.message || e) }] });
    } finally {
      setBusy("");
    }
  };

  const syntheticPayload = async () => {
    const s = await sanitizeForAi(makeSyntheticImage(640, 480));
    return { action: "providers-test", data_url: s.dataUrl };
  };

  const runProvidersTest = async () => {
    setBusy("providers");
    try {
      const res = await base44.functions.invoke("album-engine", await syntheticPayload());
      setProviders(res.data);
    } catch (e) {
      setProviders({ error: String(e?.response?.data?.error || e?.message || e) });
    } finally {
      setBusy("");
    }
  };

  const runFailover = async (skip) => {
    setBusy("failover");
    try {
      const res = await base44.functions.invoke("album-engine", { ...(await syntheticPayload()), chain_mode: true, skip });
      setFailover(res.data);
    } catch (e) {
      setFailover({ error: String(e?.response?.data?.error || e?.message || e) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4" /> Diagnóstico (solo imagen sintética)</h3>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button onClick={runSelfTest} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-secondary disabled:opacity-40">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Autoprueba de sanitización
        </button>
        <button onClick={runProvidersTest} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-secondary disabled:opacity-40">
          Probar proveedores
        </button>
        <button onClick={() => runFailover(["gemini_paid"])} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-secondary disabled:opacity-40">
          Simular: Gemini cae → ¿Qwen?
        </button>
        <button onClick={() => runFailover(["gemini_paid", "qwen"])} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-secondary disabled:opacity-40">
          Simular: Gemini+Qwen caen → ¿NVIDIA?
        </button>
      </div>

      {selfTest && (
        <div className="mt-4 space-y-1 text-xs">
          <p className="font-semibold">Sanitización (imagen sintética 1024×768): {selfTest.ok ? "✅ OK" : "❌ FALLOS"}</p>
          {selfTest.checks?.map((c) => (
            <p key={c.name} className={c.ok ? "text-emerald-600" : "text-destructive"}>
              {c.ok ? "✓" : "✗"} {c.name} — {c.detail}
            </p>
          ))}
        </div>
      )}

      {providers && (
        <div className="mt-4 space-y-1 text-xs">
          <p className="font-semibold">Matriz de proveedores:</p>
          {providers.error && <p className="text-destructive">{providers.error}</p>}
          {(providers.results || []).map((r) => (
            <p key={r.provider}>
              {r.ok ? <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="inline h-3.5 w-3.5 text-destructive" />}
              <span className="ml-1 font-medium">{r.provider}</span> —{" "}
              {r.skipped ? "simulado no disponible" : r.ok ? `OK (${r.latency_ms} ms, ${r.model}) · vía data URL · "${r.description}"` : `FALLA: ${r.reason?.slice(0, 160)}`}
            </p>
          ))}
          <p className="text-muted-foreground">Base44 InvokeLLM y Gemini FREE: excluidos de Album AI por regla de privacidad.</p>
        </div>
      )}

      {failover && (
        <div className="mt-4 text-xs">
          {failover.error ? (
            <p className="text-destructive">{failover.error}</p>
          ) : (
            <p>
              Cadena con {failover.skipped?.join(", ")} caído(s) → sirvió: <span className="font-semibold">{failover.served_by}</span>{" "}
              ({failover.latency_ms} ms) · "{failover.description}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}