// Regeneración inteligente — modifica la timeline SIN llamar al LLM cuando el
// cambio es pequeño (quitar/excluir 1-3 fotos). Conserva la estructura, las
// escenas, la música, el estilo y las decisiones del usuario. Solo recalcula
// los tiempos de inicio de los clips restantes.
//
// Si el cambio es grande (>20% de las fotos eliminadas), devuelve null para
// señalar que se necesita regeneración completa (llamada al LLM).

// Devuelve un nuevo filmPlan con la timeline filtrada, o null si el cambio
// es demasiado grande y se necesita regeneración completa.
export function regeneratePartial(filmPlan, removedHashes) {
  if (!filmPlan?.timeline?.length) return null;
  const removeSet = new Set(removedHashes);
  const originalTimeline = filmPlan.timeline;
  const newTimeline = originalTimeline.filter((t) => !removeSet.has(t.hash));

  // Nada que eliminar → sin cambios.
  if (newTimeline.length === originalTimeline.length) return filmPlan;

  // Muy pocos clips restantes → necesita regeneración completa.
  if (newTimeline.length < 3) return null;

  // >20% eliminado → la estructura narrativa puede quedar rota, regenerar.
  const removedRatio =
    (originalTimeline.length - newTimeline.length) / originalTimeline.length;
  if (removedRatio > 0.2) return null;

  // Conserva TODO del plan original (escenas, climax_at, total_duration se
  // recalculará) excepto la timeline filtrada. Las decisiones del usuario
  // (pins, exclusiones, estilo, música) viajan en la entidad, no aquí.
  return {
    ...filmPlan,
    timeline: newTimeline,
  };
}