// Punto 9 — VALIDACIÓN ANTES DE APLICAR la propuesta de Asistencia IA.
// Simula los lienzos que resultarían de aplicar el plan (sin tocar el estado real),
// los combina con los lienzos existentes que permanecerían y ejecuta validateLayout.
// Devuelve { errors, warnings }:
//   · errors   → bloquean la aplicación (supera máximo, duplicadas, geometría inválida).
//   · warnings  → no bloquean (calidad, variedad, prominencia).
import { applyLayout } from "@/modules/album/layout/layoutEngine";
import { validateLayout } from "@/modules/album/layout/layoutValidator";

// Simula los lienzos NUEVOS que crearía el plan (igual que applyAutoLayoutPlan,
// pero sin persistir ni tocar el estado). fill_photos=false → FIT en todos.
function simulateNewSpreads(project, plan) {
  const created = [];
  for (const g of plan.groups) {
    const base = {
      id: "sim_" + created.length, project_id: project.id, order_index: 0,
      mode: "spread", layout_id: g.layoutId, locked: false, ai_generated: true,
      fill_photos: false, fill_canvas: false, slots: [],
    };
    const next = applyLayout(base, g.layout, project);
    next.slots = (next.slots || []).map((sl, i) => ({ ...sl, photo_id: g.assignment[i] ?? null }));
    created.push(next);
  }
  return created;
}

// Valida un plan preparado ANTES de aplicarlo.
//   existingSpreads — lienzos actuales del álbum.
//   keepSpreads     — lienzos que permanecerán tras la operación (locked para
//                     regenerate/regenerateAll; TODOS para create, que solo añade).
//   mode            — "create" | "regenerate" | "regenerateAll".
//   maxSpreads      — límite TOTAL del álbum (null = sin límite).
export function validatePlan({ project, plan, existingSpreads, keepSpreads, mode, maxSpreads, photosById, simGroups, roleOf }) {
  const errors = [];
  const warnings = [];

  // 1) Supera el máximo de lienzos.
  if (maxSpreads != null) {
    const finalCount = keepSpreads.length + plan.groups.length;
    if (finalCount > maxSpreads) {
      errors.push({
        severity: "error",
        kind: "limit",
        message: `La propuesta genera ${finalCount} lienzos y el máximo configurado es ${maxSpreads}.`,
      });
    }
  }

  // 2) Fotografías duplicadas (una foto no puede aparecer dos veces en la propuesta).
  const allAssigned = plan.groups.flatMap((g) => g.assignment.filter(Boolean));
  const seen = new Set();
  const dupes = [];
  for (const id of allAssigned) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  // En modo create, también comprobar contra las ya colocadas en existingSpreads.
  if (mode === "create") {
    existingSpreads.forEach((s) => (s.slots || []).forEach((sl) => {
      if (sl.photo_id && seen.has(sl.photo_id)) dupes.push(sl.photo_id);
    }));
  }
  if (dupes.length) {
    errors.push({
      severity: "error",
      kind: "duplicate",
      message: `La propuesta asigna ${dupes.length} fotografía(s) más de una vez.`,
    });
  }

  // 3) Simular lienzos nuevos y validar geometría/huecos.
  const newSpreads = simulateNewSpreads(project, plan);
  for (const s of newSpreads) {
    for (const sl of s.slots || []) {
      if (!(sl.w_mm > 0) || !(sl.h_mm > 0)) {
        errors.push({
          severity: "error",
          kind: "geometry",
          message: `El lienzo «${s.layout_id}» tiene un hueco con dimensiones inválidas.`,
        });
      }
    }
  }

  // 4) Validación completa sobre el conjunto simulado (errores + avisos).
  const simAll = [...keepSpreads, ...newSpreads].map((s, i) => ({ ...s, order_index: i }));
  const findings = validateLayout({ spreads: simAll, photosById, simGroups, roleOf });
  for (const f of findings) {
    if (f.severity === "error") {
      // Evitar duplicar el aviso de límite ya añadido arriba.
      if (f.kind !== "limit") errors.push(f);
    } else {
      warnings.push(f);
    }
  }

  return { errors, warnings, canApply: errors.length === 0 };
}