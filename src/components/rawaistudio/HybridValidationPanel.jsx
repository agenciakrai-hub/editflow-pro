// Panel de validación del Revelado Híbrido. Se muestra tras la FASE 1 (perfil IA +
// adaptación local de 5 muestras), ANTES de procesar toda la sesión. Permite al
// fotógrafo revisar el look coherente propuesto y los valores finales por foto de
// muestra antes de exportar la boda completa.
import React from "react";
import { CheckCircle2, X, Sparkles, Loader2 } from "lucide-react";
import WbBreakdown from "./WbBreakdown";

const fmt = (v) => (typeof v === "number" ? (Math.round(v * 10) / 10).toString() : "—");

function ValueChips({ values, accent = "text-amber-600" }) {
  const keys = Object.keys(values || {});
  if (!keys.length) return <span className="text-xs text-muted-foreground/70">Sin datos</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => {
        const v = values[k];
        const zero = v === 0;
        return (
          <span
            key={k}
            className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
              zero ? "bg-muted text-muted-foreground/70" : "bg-secondary text-foreground"
            }`}
          >
            {k}: <span className={zero ? "text-muted-foreground/70" : accent}>{fmt(v)}</span>
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
  if (!keys.length) return <span className="text-xs text-muted-foreground/70">Sin datos</span>;
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
              zero ? "bg-muted text-muted-foreground/70" : "bg-secondary text-foreground"
            }`}
          >
            {k}: <span className={zero ? "text-muted-foreground/70" : "text-amber-600"}>{fmt(v)}</span>
            {hasDelta && (
              <span className="ml-1 text-muted-foreground">
                base {fmt(base)} · Δ{" "}
                <span className={delta > 0 ? "text-emerald-600" : "text-sky-600"}>{fmt(delta)}</span>
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
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-600">
          <Sparkles className="h-5 w-5" />
          <p className="text-sm font-semibold">Validación del Revelado Híbrido</p>
        </div>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="Cancelar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Revisa el perfil de sesión generado por la IA y los valores finales aplicados a {samples.length} fotos de
        muestra. Si el look es coherente, confirma para procesar toda la sesión ({total} fotos) sin más llamadas de IA.
      </p>

      {/* Perfil de sesión (IA) */}
      <div className="rounded-md border border-border bg-secondary p-3 space-y-2">
        <p className="text-xs font-medium text-foreground">Perfil de sesión (IA)</p>
        <p className="text-xs text-muted-foreground">{profile?.analysis || "Sin descripción"}</p>
        <p className="text-xs text-muted-foreground">Confianza: {profile?.confidence ?? "—"}</p>
        {recipeKeys.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {recipeKeys.map((k) => (
              <span
                key={k}
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                  recipe[k] === 0 ? "bg-muted text-muted-foreground/70" : "bg-card text-foreground"
                }`}
              >
                {k}: <span className={recipe[k] === 0 ? "text-muted-foreground/70" : "text-sky-600"}>{fmt(recipe[k])}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70">Recipe base sin desplazamientos</p>
        )}
      </div>

      {/* Muestras con valores finales */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">
          Valores finales aplicados a {samples.length} fotos de muestra
        </p>
        <div className="grid grid-cols-1 gap-2">
          {samples.map((s) => (
            <div key={s.id} className="flex gap-3 rounded-md border border-border bg-card p-2">
              {s.preview ? (
                <img
                  src={`data:image/jpeg;base64,${s.preview}`}
                  alt={s.filename}
                  className="h-16 w-16 flex-shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-16 w-16 flex-shrink-0 rounded bg-secondary" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{s.filename}</p>
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
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
        >
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {confirming ? "Procesando…" : `Confirmar y procesar ${total} fotos`}
        </button>
        <button
          onClick={onCancel}
          disabled={confirming}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}