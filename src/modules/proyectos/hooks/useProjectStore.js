// Acceso a las entidades del módulo de Proyectos. Nunca sube RAW ni .lrcat — solo
// metadatos, fingerprints y referencias opacas a IndexedDB.
import { base44 } from "@/api/base44Client";

export async function listProjects() {
  return base44.entities.Project.list("-created_date", 50);
}

export async function getProject(id) {
  return base44.entities.Project.get(id);
}

export async function createProject(data) {
  return base44.entities.Project.create(data);
}

export async function updateProject(id, data) {
  return base44.entities.Project.update(id, data);
}

export async function getCatalogBinding(projectId) {
  const rows = await base44.entities.CatalogBinding.filter({ project_id: projectId });
  return rows[0] || null;
}

export async function createCatalogBinding(data) {
  return base44.entities.CatalogBinding.create(data);
}

export async function updateCatalogBinding(id, data) {
  return base44.entities.CatalogBinding.update(id, data);
}

export async function listFingerprints(projectId) {
  return base44.entities.ProjectPhotoFingerprint.filter({ project_id: projectId });
}

export async function bulkCreateFingerprints(rows) {
  return base44.entities.ProjectPhotoFingerprint.bulkCreate(rows);
}

export async function bulkUpdateFingerprints(rows) {
  return base44.entities.ProjectPhotoFingerprint.bulkUpdate(rows);
}