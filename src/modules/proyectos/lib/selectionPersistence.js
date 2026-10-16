// Identidad de archivo: el pHash puede repetirse en fotografías distintas de una ráfaga.
const key = photo => JSON.stringify([
  photo.fingerprint?.relative_path || photo.relative_path || photo.file?.webkitRelativePath || photo.filename || photo.file?.name,
  photo.fingerprint?.filename || photo.filename || photo.file?.name,
  photo.fingerprint?.file_size ?? photo.file_size ?? photo.file?.size ?? 0,
]);
export function selectionUpdates(meta, items, fingerprints) {
  const byFile = new Map(items.map(photo => [key(photo), photo.id]));
  const updates = [];
  for (const fp of fingerprints) {
    const id = byFile.get(key(fp));
    const result = meta.get(id);
    if (!result) continue;
    const selected = result.status === 'SELECT' || result.status === 'TOP_PICK';
    const winner = [...meta.entries()].find(([,m])=>m.groupId===result.groupId && m.status==="TOP_PICK");
    const winnerFp = winner && fingerprints.find(other=>byFile.get(key(other))===winner[0]);
    const comparison = result.comparisonComplete ? {version:"burst-winner-v2",burst_id:result.groupId,winner_id:winnerFp?.id || null,reason:result.reason,group_size:result.groupSize} : undefined;
    updates.push({selection_comparison:comparison,id:fp.id,selection_status:result.status,rating:selected?5:result.status==='REJECT'?0:3,color_label:selected?'green':result.status==='REJECT'?'red':'yellow'});
  }
  return updates;
}
