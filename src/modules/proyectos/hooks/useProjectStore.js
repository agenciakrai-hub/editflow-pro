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

// El SDK limita las operaciones masivas a 500 registros por llamada. Partimos en lotes
// para que proyectos grandes (>500 fotos) no fallen al crear/actualizar fingerprints.
const BULK_CHUNK = 400;

export async function bulkCreateFingerprints(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    out.push(...(await base44.entities.ProjectPhotoFingerprint.bulkCreate(rows.slice(i, i + BULK_CHUNK))));
  }
  return out;
}

export async function bulkUpdateFingerprints(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    out.push(...(await base44.entities.ProjectPhotoFingerprint.bulkUpdate(rows.slice(i, i + BULK_CHUNK))));
  }
  return out;
}