export const fileIdentity = photo => JSON.stringify([
 photo.fingerprint?.relative_path || photo.relative_path || photo.file?.webkitRelativePath || photo.filename || photo.file?.name,
 photo.fingerprint?.filename || photo.filename || photo.file?.name,
 photo.fingerprint?.file_size ?? photo.file_size ?? photo.file?.size ?? 0,
]);
export function pendingSelectionItems(items, fingerprints, checkpoint) {
 const completed = new Set(checkpoint?.stage_progress?.completed_fingerprint_ids || []);
 const targets = checkpoint?.stage_progress?.target_fingerprint_ids;
 if (!completed.size || (!Array.isArray(targets) && checkpoint?.stage_progress?.resume_scope !== "folder"))
   throw new Error("El trabajo no tiene un punto de continuación verificable");
 const targetSet = Array.isArray(targets) ? new Set(targets) : null;
 const byKey = new Map(fingerprints.map(fp => [fileIdentity(fp), fp.id]));
 const pending = [];
 for (const item of items) {
   const fpId = byKey.get(fileIdentity(item));
   if (!fpId) throw new Error("Una foto no coincide con los archivos guardados; vuelve a abrir la carpeta");
   if ((!targetSet || targetSet.has(fpId)) && !completed.has(fpId)) pending.push(item);
 }
 const expected = targetSet ? [...targetSet].filter(id => !completed.has(id)).length : fingerprints.length - completed.size;
 if (pending.length !== expected) throw new Error("Faltan fotos de la selección pendiente; vuelve a abrir la carpeta completa");
 return pending;
}
