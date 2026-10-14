// Una principal por ráfaga y pose; las alternativas válidas quedan para revisión.
export function applyBurstSelectionPolicy(keep, meta, photos) {
  const photosById = new Map(photos.map(p => [p.id, p]));
  // RAW+JPEG de la misma exposición son dos archivos, pero no dos poses.
  // Exige nombre base, carpeta y fecha exacta; no fusiona fotos visualmente parecidas.
  const frames = new Map();
  for (const photo of photos) {
    const name = photo.file?.name || photo.fingerprint?.filename || '';
    const time = photo.captureTime || photo.fingerprint?.capture_time;
    if (!name || !time || !meta.has(photo.id)) continue;
    const path = photo.fingerprint?.relative_path || photo.file?.webkitRelativePath || name;
    const key = JSON.stringify([path.replace(/\.[^.]+$/, '').toLowerCase(), String(time)]);
    if (!frames.has(key)) frames.set(key, []);
    frames.get(key).push({photo, name});
  }
  for (const frame of frames.values()) {
    if (frame.length < 2) continue;
    const raw = frame.find(p => /\.(raf|dng|cr[23]|nef|arw|orf|rw2)$/i.test(p.name));
    const pose = meta.get((raw || frame[0]).photo.id)?.poseKey;
    if (pose) for (const p of frame) meta.get(p.photo.id).poseKey = pose;
  }
  const groups = new Map();
  const segments = new Map();
  // Orden de captura, independiente del orden en que terminen las peticiones.
  const orderedIds = [...photos.map(p => p.id), ...meta.keys()];
  const seen = new Set();
  for (const id of orderedIds) {
    if (seen.has(id) || !meta.has(id)) continue;
    seen.add(id);
    const m = meta.get(id);
    const base = m.groupId || `single-${id}`;
    const previous = segments.get(base);
    const rawPose = String(m.poseKey || '').trim().toLowerCase().replace(/[ _]+/g, '-');
    const pose = !rawPose || rawPose === 'unknown' ? (previous?.pose || 'unknown') : rawPose;
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
    if (people) {
      const metrics = [[s.eye_quality, 4], [s.expression, 4], [s.focus ?? s.focus_accuracy ?? s.sharpness, 2], [s.moment_quality, 1]]
        .filter(([value]) => Number.isFinite(value));
      return metrics.reduce((sum, [value, weight]) => sum + value * weight, 0) / metrics.reduce((sum, [, weight]) => sum + weight, 0);
    }
    if (Number.isFinite(s.overall)) return s.overall;
    const t = photosById.get(id)?.technical || {};
    return (t.sharpness ?? 0) + (t.exposureScore ?? 0);
  };
  const promotions = [];
  for (const [group, entries] of groups) {
    const ordered = [...entries].sort((a, b) => score(b) - score(a) || (a[1].groupRank ?? 999) - (b[1].groupRank ?? 999));
    // Si existe una candidata sin ojos cerrados/defecto crítico, no gana una defectuosa
    // por inconsistencias entre sus puntuaciones y las razones del proveedor.
    const critical = new Set(['EYES_CLOSED', 'CRITICAL_BLUR', 'FOCUS_FAILURE', 'CORRUPT', 'SEVERE_EXPOSURE_FAILURE']);
    const usable = ordered.filter(([, m]) => !(m.rejectReasons || []).some(reason => critical.has(reason)));
    const bestId = (usable.length ? usable : ordered)[0][0];
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
