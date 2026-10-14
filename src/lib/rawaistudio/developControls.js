import { PARAM_DEFS } from './paramDefs';
export function applyEnabledDevelopValues(values, enabled, preferences = {}) {
  const out = {};
  for (const key of enabled) {
    if (key === 'Temperature' || key === 'Tint') continue;
    if (!Number.isFinite(values?.[key])) continue;
    const range = PARAM_DEFS.find(p => p.key === key);
    const preference = Number(preferences[key]);
    const value = values[key] + (Number.isFinite(preference) ? preference : 0);
    out[key] = range ? Math.min(range.max, Math.max(range.min, value)) : value;
  }
  return out;
}
export function applyEnabledWhiteBalance(wb, enabled) {
  if (!wb) return null;
  const writeTemperature = enabled.includes('Temperature');
  const writeTint = enabled.includes('Tint');
  if (wb.auto) return { ...wb, write: !!wb.write && writeTemperature && writeTint, writeTemperature, writeTint };
  const changed = (writeTemperature && Math.abs(wb.temperatureDelta || 0) > 20) || (writeTint && Math.abs(wb.tintDelta || 0) > 2);
  return { ...wb, write: !!wb.write && changed, writeTemperature, writeTint };
}
