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
  return base44.entities.ProjectPhotoFingerprint.filter({ project_id: projectId }, "-created_date", 5000);
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

// Reemplaza todos los fingerprints del proyecto por el estado actual del espacio de
// trabajo (fotos eliminadas y cambios de estado incluidos). Filtra por project_id.
export async function deleteFingerprintsByProject(projectId) {
  return base44.entities.ProjectPhotoFingerprint.deleteMany({ project_id: projectId });
}

// ---- Carpetas / sesiones del proyecto (ProjectFolder) ----
// Cada carpeta es una unidad de trabajo independiente dentro del proyecto: tiene sus
// propias fotos (fingerprints con folder_id), su propia selección y su propia edición.
export async function listFolders(projectId) {
  return base44.entities.ProjectFolder.filter({ project_id: projectId }, "order_index", 200);
}

export async function createFolder(data) {
  return base44.entities.ProjectFolder.create(data);
}

export async function updateFolder(id, data) {
  return base44.entities.ProjectFolder.update(id, data);
}

export async function deleteFolder(id) {
  return base44.entities.ProjectFolder.delete(id);
}

// Fingerprints de UNA carpeta concreta (la unidad de trabajo independiente).
export async function listFingerprintsByFolder(folderId) {
  return base44.entities.ProjectPhotoFingerprint.filter({ folder_id: folderId }, "-created_date", 5000);
}

// Borra solo los fingerprints de UNA carpeta (no toca las demás carpetas del proyecto).
export async function deleteFingerprintsByFolder(folderId) {
  return base44.entities.ProjectPhotoFingerprint.deleteMany({ folder_id: folderId });
}

// Migración automática de proyectos existentes (una sola carpeta RAW → una ProjectFolder).
// Idempotente: si el proyecto ya tiene carpetas, no hace nada. Si no tiene carpetas pero
// tiene fingerprints, crea una carpeta por defecto y asigna todos los fingerprints a ella.
// Devuelve la lista de carpetas del proyecto (vacía si es un proyecto nuevo sin fotos).
export async function ensureFoldersMigrated(projectId) {
  const folders = await listFolders(projectId);
  if (folders.length > 0) return folders;
  const fps = await listFingerprints(projectId);
  if (fps.length === 0) return [];
  // Proyecto existente sin carpetas: migra desde el CatalogBinding legado.
  const binding = await getCatalogBinding(projectId);
  const defaultFolder = await createFolder({
    project_id: projectId,
    name: "01 - Carpeta actual",
    order_index: 0,
    raw_folder_name: binding?.raw_folder_name || "",
    raw_folder_handle_ref: binding?.raw_folder_handle_ref || "",
    catalog_filename: binding?.catalog_filename || "",
    catalog_handle_ref: binding?.catalog_handle_ref || "",
    photo_count: fps.length,
    import_status: "completed",
    selection_status: fps.some((f) => f.selection_status === "TOP_PICK" || f.selection_status === "SELECT") ? "completed" : "pending",
    edit_status: "pending",
    last_modified: new Date().toISOString(),
  });
  // Asigna todos los fingerprints existentes a la carpeta por defecto.
  await bulkUpdateFingerprints(fps.map((f) => ({ id: f.id, folder_id: defaultFolder.id })));
  return [defaultFolder];
}