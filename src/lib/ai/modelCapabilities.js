// READER de capacidades (no clasifica). La fuente única de verdad de capacidades vive
// en el backend (base44/shared/modelCapabilities.ts) y se persiste en
// CustomAiProvider.available_models_meta. Este módulo SOLO LEE esas caps resueltas
// para que la UI habilite/deshabilite casillas. NO usa regex ni el nombre del modelo.

// Tarea → clave de capacidad requerida.
export function capKeyForTask(task) {
  if (task === "seleccion" || task === "ajustes" || task === "album") return "vision";
  if (task === "edicion") return "image_edit";
  if (task === "video") return "video";
  return null;
}

// ¿La entrada meta del modelo CONFIRMA la tarea? Solo caps[capKey] === true.
// false = verificado NO compatible; null = no verificado. El runtime bloquea false y
// null (solo true ejecuta); la UI deshabilita la casilla en ambos casos.
export function taskAllowed(metaEntry, task) {
  const k = capKeyForTask(task);
  if (!k || !metaEntry) return false;
  return metaEntry?.caps?.[k] === true;
}

// ¿El modelo es CANDIDATO para la pestaña de la herramienta? true si hay evidencia
// positiva (caps === true) O no hay evidencia suficiente (null). false SOLO si está
// verificado como NO compatible (caps === false). Así una pestaña nunca muestra "0"
// cuando el proveedor no declara capacidades (caso NVIDIA): los no verificados aparecen
// como candidatos con "Probar". Es la misma fuente de verdad (available_models_meta).
export function taskCandidate(metaEntry, task) {
  const k = capKeyForTask(task);
  if (!k || !metaEntry) return true; // sin meta → candidato (no verificado)
  return metaEntry?.caps?.[k] !== false;
}

// Estado conceptual de la casilla para (metaEntry, task, marked):
//  "compatible"        → habilitada, no marcada
//  "compatible_marked"  → habilitada, marcada
//  "incompatible"       → deshabilitada (verificado NO compatible)
//  "unverified"         → deshabilitada (sin evidencia; mostrar "Probar capacidad")
//  "marked_unverified"  → deshabilitada pero marcada (config antigua preservada; no ejecuta hasta verificar)
export function checkboxState(metaEntry, task, marked) {
  const k = capKeyForTask(task);
  if (!k || !metaEntry) return marked ? "marked_unverified" : "unverified";
  const v = metaEntry?.caps?.[k];
  if (v === true) return marked ? "compatible_marked" : "compatible";
  if (v === false) return marked ? "marked_unverified" : "incompatible";
  return marked ? "marked_unverified" : "unverified";
}