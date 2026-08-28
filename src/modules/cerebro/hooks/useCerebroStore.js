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
export async function listCorrections(styleId) {
  return base44.entities.StyleCorrectionRecord.filter({ style_id: styleId });
}
export async function createCorrection(data) {
  return base44.entities.StyleCorrectionRecord.create(data);
}