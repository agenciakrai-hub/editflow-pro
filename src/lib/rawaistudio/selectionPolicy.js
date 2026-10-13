// Una principal por ráfaga y pose; las alternativas válidas quedan para revisión.
export function applyBurstSelectionPolicy(keep, meta, photos) {
  const photosById = new Map(photos.map(p => [p.id, p]));
  const groups = new Map();
  const segments = new Map();
  for (const [id, m] of meta) {
    const base = m.groupId || `single-${id}`;
    const pose = m.poseKey || 'unknown';
    const previous = segments.get(base);
    const segment = previous ? previous.segment + (previous.pose !== pose ? 1 : 0) : 0;
    segments.set(base, { pose, segment });
    const key = `${base}:pose-${segment}`;
    m.groupId = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([id, m]);
  }
  const score = ([id, m]) => {
    const s = m.scores || {};
    const people = Number.isFinite(s.eye_quality) || Number.isFinite(s.expression);
    if (people) return (s.eye_quality ?? 0) * 4 + (s.expression ?? 0) * 4 + (s.focus_accuracy ?? s.sharpness ?? 0) * 2 + (s.moment_quality ?? 0);
    if (Number.isFinite(s.overall)) return s.overall;
    const t = photosById.get(id)?.technical || {};
    return (t.sharpness ?? 0) + (t.exposureScore ?? 0);
  };
  const promotions = [];
  for (const [group, entries] of groups) {
    const ordered = [...entries].sort((a, b) => score(b) - score(a) || (a[1].groupRank ?? 999) - (b[1].groupRank ?? 999));
    const bestId = ordered[0][0];
    const forced = !entries.some(([, m]) => ['SELECT', 'TOP_PICK'].includes(m.status));
    entries.forEach(([id, m]) => {
      keep.delete(id);
      m.groupSize = entries.length;
      if (id === bestId) {
        m.status = 'TOP_PICK'; m.groupRank = 1; keep.add(id);
        if (forced) {
          m.selection_fallback = true;
          m.fallback_reason = 'mandatory_burst_representative';
          m.reason = `${m.reason || ''} · Única representante obligatoria; revisar sus avisos de calidad.`;
          promotions.push({ group, photo_id: id, reason: 'MANDATORY_BURST_REPRESENTATIVE' });
        }
      } else if (['SELECT', 'TOP_PICK'].includes(m.status)) m.status = 'REVIEW';
      m.rating = id === bestId ? 5 : m.status === 'REVIEW' ? 3 : 0;
      m.colorLabel = id === bestId ? 'green' : m.status === 'REVIEW' ? 'yellow' : 'red';
    });
  }
  return { selection_coverage_fallback: promotions.length > 0, promotions, exceptional_groups: [] };
}
