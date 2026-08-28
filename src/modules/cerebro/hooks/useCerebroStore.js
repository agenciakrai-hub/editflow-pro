// Acceso a las entidades del módulo Cerebro (presets registrados, estilos del
// fotógrafo y correcciones aprendidas). Nada de esto toca los motores de edición.
import { base44 } from "@/api/base44Client";

// ---- Presets registrados ----
export async function listPresets() {
  return base44.entities.PresetRegistry.list("-created_date", 100);
}
export async function createPreset(data) {
  return base44.entities.PresetRegistry.create(data);
}
export async function deletePreset(id) {
  return base44.entities.PresetRegistry.delete(id);
}

// ---- Estilos del fotógrafo ----
export async function listStyles() {
  return base44.entities.PhotographerStyle.list("-created_date", 100);
}
export async function createStyle(data) {
  return base44.entities.PhotographerStyle.create(data);
}
export async function updateStyle(id, data) {
  return base44.entities.PhotographerStyle.update(id, data);
}
export async function deleteStyle(id) {
  return base44.entities.PhotographerStyle.delete(id);
}

// ---- Correcciones aprendidas ----
// Se leen vía backend (asServiceRole) para validar propiedad del estilo; el plugin
// escribe los registros sin created_by_id de usuario, así no se exponen directo por RLS.
export async function listCorrections(styleId) {
  const res = await base44.functions.invoke("editflow-engine", { action: "style-corrections", style_id: styleId });
  return res?.data?.corrections || [];
}
export async function createCorrection(data) {
  return base44.entities.StyleCorrectionRecord.create(data);
}