export function requireDevelopNumbers(result: any, keys: string[]): void {
  const missing = keys.filter(key => !Number.isFinite(result?.[key]));
  if (missing.length) throw new Error(`La IA devolvió ajustes incompletos o inválidos: ${missing.join(', ')}. No se ha generado el XMP.`);
}
