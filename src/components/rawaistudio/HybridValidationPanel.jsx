// Panel de validación del Revelado Híbrido. Se muestra tras la FASE 1 (perfil IA +
// adaptación local de 5 muestras), ANTES de procesar toda la sesión. Permite al
// fotógrafo revisar el look coherente propuesto y los valores finales por foto de
// muestra antes de exportar la boda completa.
import React from "react";
import { CheckCircle2, X, Sparkles, Loader2 } from "lucide-react";
import WbBreakdown from "./WbBreakdown";

const fmt = (v) => (typeof v === "number" ? (Math.round(v * 10) / 10).toString() : "—");

function ValueChips({ values, accent = "text-amber-400" }) {
  const keys = Object.keys(values || {});
  if (!keys.length) return <span className="text-xs text-zinc-600">Sin datos</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => {
        const v = values[k];
        const zero = v === 0;
        return (
          <span
            key={k}
            className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
              zero ? "bg-zinc-900 text-zinc-600" : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {k}: <span className={zero ? "text-zinc-600" : accent}>{fmt(v)}</span>
          </span>
        );
      })}
    </div>
  );
}

// Desglose por foto: valor final = base (perfil IA) + delta local. Solo muestra el
// desglose cuando el delta != 0 (los creativos de sesión, uniformes, quedan limpios).
// Así el fotógrafo ve qué aporta la IA y qué corrige el motor por foto — y detecta si
// el delta es idéntico en todas las muestras (motor sin trabajo real por foto).
function BreakdownChips({ values, recipe }) {
  const keys = Object.keys(values || {});
  if (!keys.length) return <span className="text-xs text-zinc-600">Sin datos</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => {
        const v = values[k];
        const base = typeof recipe?.[k] === "number" ? recipe[k] : 0;
        const delta = (typeof v === "number" ? v : 0) - base;
        const zero = v === 0;
        const hasDelta = Math.abs(delta) > 0.01;
        return (
          <span
            key={k}
            className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
              zero ? "bg-zinc-900 text-zinc-600" : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {k}: <span className={zero ? "text-zinc-600" : "text-amber-400"}>{fmt(v)}</span>
            {hasDelta && (
              <span className="ml-1 text-zinc-500">
                base {fmt(base)} · Δ{" "}
                <span className={delta > 0 ? "text-emerald-400" : "text-sky-400"}>{fmt(delta)}</span>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function HybridValidationPanel({
  profile,
  samples,
  total,
  confirming,
  onConfirm,
  onCancel,
}) {
  const recipe = profile?.base_recipe || {};
  const recipeKeys = Object.keys(recipe);

  return (
    <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-400">
          <Sparkles className="h-5 w-5" />
          <p className="text-sm font-semibold">Validación del Revelado Híbrido</p>
        </div>
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300" aria-label="Cancelar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-zinc-400">
        Revisa el perfil de sesión generado por la IA y los valores finales aplicados a {samples.length} fotos de
        muestra. Si el look es coherente, confirma para procesar toda la sesión ({total} fotos) sin más llamadas de IA.
      </p>

      {/* Perfil de sesión (IA) */}
      <div className="rounded-md border border-zinc-700 bg-zinc-900 p-3 space-y-2">
        <p className="text-xs font-medium text-zinc-200">Perfil de sesión (IA)</p>
        <p className="text-xs text-zinc-500">{profile?.analysis || "Sin descripción"}</p>
        <p className="text-xs text-zinc-500">Confianza: {profile?.confidence ?? "—"}</p>
        {recipeKeys.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {recipeKeys.map((k) => (
              <span
                key={k}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                  recipe[k] === 0 ? "bg-zinc-900 text-zinc-600" : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {k}: <span className={recipe[k] === 0 ? "text-zinc-600" : "text-sky-400"}>{fmt(recipe[k])}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">Recipe base sin desplazamientos</p>
        )}
      </div>

      {/* Muestras con valores finales */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-200">
          Valores finales aplicados a {samples.length} fotos de muestra
        </p>
        <div className="grid grid-cols-1 gap-2">
          {samples.map((s) => (
            <div key={s.id} className="flex gap-3 rounded-md border border-zinc-800 bg-[#141414] p-2">
              {s.preview ? (
                <img
                  src={`data:image/jpeg;base64,${s.preview}`}
                  alt={s.filename}
                  className="h-16 w-16 flex-shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-16 w-16 flex-shrink-0 rounded bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-200">{s.filename}</p>
                <div className="mt-1">
                  <BreakdownChips values={s.values} recipe={recipe} />
                </div>
                {s.wb && (
                  <div className="mt-1">
                    <WbBreakdown wb={s.wb} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40"
        >
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {confirming ? "Procesando…" : `Confirmar y procesar ${total} fotos`}
        </button>
        <button
          onClick={onCancel}
          disabled={confirming}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}