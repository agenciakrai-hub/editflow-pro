// CRUD contra las entidades Album* — única puerta de datos del módulo. RLS por usuario;
// sin dependencias con ninguna entidad existente de EditFlow.
import { base44 } from "@/api/base44Client";

export async function listAlbums() {
  return base44.entities.AlbumProject.list("-updated_date", 100);
}

export async function getAlbum(id) {
  return base44.entities.AlbumProject.get(id);
}

export async function createAlbum(data) {
  return base44.entities.AlbumProject.create(data);
}

export async function updateAlbum(id, patch) {
  return base44.entities.AlbumProject.update(id, patch);
}

export async function deleteAlbum(id) {
  await base44.entities.AlbumPhoto.deleteMany({ project_id: id });
  await base44.entities.AlbumSpread.deleteMany({ project_id: id });
  await base44.entities.AlbumProject.delete(id);
}

export async function listPhotos(projectId) {
  return base44.entities.AlbumPhoto.filter({ project_id: projectId }, "filename", 2000);
}

export async function addPhotos(metas) {
  return base44.entities.AlbumPhoto.bulkCreate(metas);
}

export async function listSpreads(projectId) {
  return base44.entities.AlbumSpread.filter({ project_id: projectId }, "order_index", 500);
}

export async function createSpread(data) {
  return base44.entities.AlbumSpread.create(data);
}

export async function updateSpread(id, patch) {
  return base44.entities.AlbumSpread.update(id, patch);
}

export async function deleteSpread(id) {
  return base44.entities.AlbumSpread.delete(id);
}

// Fase 3.1 — actualización del catálogo: re-localización, identidad y estados
// (ok/missing/unlinked) de AlbumPhoto. Solo metadatos; jamás imágenes.
export async function updatePhoto(id, patch) {
  return base44.entities.AlbumPhoto.update(id, patch);
}

export async function bulkUpdatePhotos(list) {
  return base44.entities.AlbumPhoto.bulkUpdate(list);
}