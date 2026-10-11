// A failed or incomplete analysis must never become a successful empty XMP.
export function requireVisualValues(data, id, keys) {
  const error = data?.errors?.[id];
  if (error) throw new Error(String(error));
  const values = data?.results?.[id];
  if (!values || typeof values !== "object" || keys.some((key) => !Number.isFinite(values[key]))) {
    throw new Error("La IA no devolvió ajustes válidos para esta foto. No se ha generado un XMP.");
  }
  return values;
}
