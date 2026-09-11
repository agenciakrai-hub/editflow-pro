// Tests de la agrupación de ráfagas — 100 % puros (sin DOM, sin red): señales
// sintéticas 16×16 y un resolver de visión simulado. Ejecutar con
// `await runGroupBuilderTests()` desde la consola del navegador.
// Casos exigidos: misma ráfaga · escena diferente · giro brusco de cabeza ·
// cambio de pose · cambio de expresión · sujeto entra/sale · ráfaga larga (>12) ·
// el tiempo solo NUNCA une · sin señal local · sin capture_time · deriva del ancla ·
// visión no disponible.
import { buildGroups, phashHexDistance, frameSignalDistance } from "./groupBuilder";

const T0 = 1750000000000;

// Señal sintética: todas las celdas a 100 + delta. La distancia entre sig(d1) y
// sig(d2) es |d1 - d2| / 255, lo que permite colocar cada frontera exactamente en
// la banda deseada: unión local (≤0.012 / ≤0.03), ambigua (0.03–0.10) o escena
// distinta (>0.10).
function sig(delta) {
  return Float32Array.from({ length: 256 }, () => 100 + delta);
}
function photo(id, t, phash = "0000000000000000") {
  return { id, capture_time: t, phash };
}
function signalsOf(entries) {
  return new Map(entries);
}
const resolverReturning = (values) => async () => values;
const resolverThrowing = async () => {
  throw new Error("visión no disponible");
};

export async function runGroupBuilderTests() {
  const checks = [];
  const run = async (name, opts, expected, extra) => {
    try {
      const groups = await buildGroups(opts);
      const ids = groups.map((g) => g.photo_ids);
      const ok = JSON.stringify(ids) === JSON.stringify(expected);
      checks.push({
        name,
        ok,
        detail: ok ? extra || "ok" : `obtenido ${JSON.stringify(ids)} ≠ esperado ${JSON.stringify(expected)}`,
      });
      return groups;
    } catch (e) {
      checks.push({ name, ok: false, detail: `excepción: ${e?.message || e}` });
      return null;
    }
  };

  // Utilidades puras.
  checks.push({ name: "phashHexDistance idénticas = 0", ok: phashHexDistance("0".repeat(16), "0".repeat(16)) === 0, detail: "ok" });
  checks.push({ name: "phashHexDistance opuestas = 64", ok: phashHexDistance("0".repeat(16), "f".repeat(16)) === 64, detail: "ok" });
  checks.push({
    name: "frameSignalDistance normalizada",
    ok: Math.abs(frameSignalDistance(sig(0), sig(10)) - 10 / 255) < 1e-9,
    detail: `${frameSignalDistance(sig(0), sig(10))}`,
  });

  // 1. MISMA RÁFAGA: 5 disparos consecutivos casi idénticos → un único grupo (burst).
  const g1 = await run(
    "misma ráfaga (5 disparos casi idénticos) → 1 grupo",
    {
      photos: [1, 2, 3, 4, 5].map((i) => photo(`p${i}`, T0 + i * 1000)),
      signals: signalsOf([["p1", sig(0)], ["p2", sig(1)], ["p3", sig(1)], ["p4", sig(1)], ["p5", sig(1)]]),
    },
    [["p1", "p2", "p3", "p4", "p5"]]
  );
  checks.push({ name: "  · kind = burst", ok: g1?.[0]?.kind === "burst", detail: g1?.[0]?.kind || "?" });

  // 2. ESCENA DIFERENTE con Δt = 1 s → nueva ráfaga aunque el tiempo sea mínimo.
  await run(
    "escena diferente con Δt=1s → 2 grupos",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 1000, "ffffffff00000000")],
      signals: signalsOf([["p1", sig(0)], ["p2", sig(40)]]),
    },
    [["p1"], ["p2"]],
    "el tiempo solo NUNCA une"
  );

  // 3. GIRO BRUSCO DE CABEZA (caso crítico del usuario): mismas escena/encuadre,
  //    pero entre p2 y p3 el sujeto gira la cabeza. Localmente es ambiguo → la
  //    visión decide NUEVO momento → Ráfaga A [p1,p2] + Ráfaga B [p3,p4,p5].
  await run(
    "giro brusco de cabeza → A[p1,p2] + B[p3,p4,p5]",
    {
      photos: [1, 2, 3, 4, 5].map((i) => photo(`p${i}`, T0 + i * 1000)),
      signals: signalsOf([
        ["p1", sig(0)], ["p2", sig(1)],
        ["p3", sig(11)], ["p4", sig(11)], ["p5", sig(11)],
      ]),
      resolveContinuity: resolverReturning([false]),
    },
    [["p1", "p2"], ["p3", "p4", "p5"]],
    "frontera p2→p3 resuelta por visión: cambio de momento"
  );

  // 4. CAMBIO DE POSE: ambiguo → visión dice nuevo momento → nueva ráfaga.
  await run(
    "cambio de pose (visión: nuevo momento) → 2 grupos",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 2000)],
      signals: signalsOf([["p1", sig(0)], ["p2", sig(12)]]),
      resolveContinuity: resolverReturning([false]),
    },
    [["p1"], ["p2"]]
  );

  // 5. CAMBIO DE EXPRESIÓN decidido por visión como CONTINUIDAD (diferencia
  //    sutil que NO rompe la ráfaga): mismo grupo.
  await run(
    "cambio de expresión sutil (visión: continúa) → 1 grupo",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 1500)],
      signals: signalsOf([["p1", sig(0)], ["p2", sig(9)]]),
      resolveContinuity: resolverReturning([true]),
    },
    [["p1", "p2"]],
    "la visión decide que la expresión no cambia el momento"
  );

  // 6. SUJETO QUE ENTRA/SALE del encuadre: ambiguo → visión decide nueva ráfaga.
  await run(
    "sujeto entra/sale (visión: nuevo momento) → 2 grupos",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 1200)],
      signals: signalsOf([["p1", sig(0)], ["p2", sig(20)]]),
      resolveContinuity: resolverReturning([false]),
    },
    [["p1"], ["p2"]]
  );

  // 7. RÁFAGA LARGA (>12 fotos): 20 disparos casi idénticos → UN grupo.
  //    El antiguo MAX_GROUP=12 la habría partido artificialmente.
  const longIds = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
  await run(
    "ráfaga larga de 20 fotos → 1 grupo (sin corte en 12)",
    {
      photos: longIds.map((id, i) => photo(id, T0 + i * 500)),
      signals: signalsOf(longIds.map((id, i) => [id, sig(i % 2)])),
    },
    [longIds]
  );

  // 8. SOLO TIEMPO NO UNE: Δt = 2 s pero cambio visual claro → grupos distintos.
  await run(
    "Δt=2s con cambio claro de encuadre → 2 grupos",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 2000)],
      signals: signalsOf([["p1", sig(0)], ["p2", sig(30)]]),
    },
    [["p1"], ["p2"]]
  );

  // 9. SIN SEÑAL LOCAL (sin preview): continuidad solo por pHash; el tiempo
  //    jamás une por sí solo.
  await run(
    "sin señal: mismo pHash une, pHash distinto corta",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 3000), photo("p3", T0 + 5000, "0f0f0f0f0f0f0f0f")],
      signals: new Map(),
    },
    [["p1", "p2"], ["p3"]]
  );

  // 10. SIN CAPTURE_TIME: nunca se mezclan con las temporizadas → singles.
  await run(
    "sin capture_time → cada foto es su propio grupo",
    {
      photos: [{ id: "u1", phash: "0000000000000000" }, { id: "u2", phash: "0000000000000000" }],
      signals: new Map(),
    },
    [["u1"], ["u2"]]
  );

  // 11. DERIVA DEL ANCLA (sustituye al MAX_GROUP): cadena de 40 fotos donde cada
  //     frontera es mínima (unión local) pero la deriva acumulada respecto al
  //     ORIGEN crece: la cadena se rompe por CONTINUIDAD, no por tamaño.
  const driftIds = Array.from({ length: 40 }, (_, i) => `d${i + 1}`);
  const driftExpected = [driftIds.slice(0, 36), driftIds.slice(36)];
  await run(
    "deriva del ancla: cadena gradual se rompe por continuidad",
    {
      photos: driftIds.map((id, i) => photo(id, T0 + i * 500)),
      signals: signalsOf(driftIds.map((id, i) => [id, sig(i)])),
    },
    driftExpected,
    "corte en d36: deriva > 0.14 respecto al ancla"
  );

  // 12. VISIÓN NO DISPONIBLE sobre una frontera ambigua: unión conservadora
  //     (no se parte una ráfaga dudosa sin pruebas).
  await run(
    "visión no disponible → unión conservadora",
    {
      photos: [photo("p1", T0), photo("p2", T0 + 1000)],
      signals: signalsOf([["p1", sig(0)], ["p2", sig(15)]]),
      resolveContinuity: resolverThrowing,
    },
    [["p1", "p2"]]
  );

  // 13. ORDEN TEMPORAL conservado: los ids nunca cambian y salen ordenados.
  await run(
    "orden temporal conservado (entrada desordenada)",
    {
      photos: [photo("late", T0 + 60000), photo("early", T0), photo("mid", T0 + 30000)],
      signals: signalsOf([["early", sig(0)], ["mid", sig(50)], ["late", sig(50)]]),
    },
    [["early"], ["mid"], ["late"]]
  );

  return { ok: checks.every((c) => c.ok), checks, failed: checks.filter((c) => !c.ok).map((c) => c.name) };
}