// El plugin escribe estos bytes como sidecar XMP: deben ser UTF-8, no Latin-1.
export function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
