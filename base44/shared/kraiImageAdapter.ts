// Server-side KRAI transport. Keys never appear in the browser response.
export function isKraiGateway(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && /\/api\/gateway\/v1\/?$/.test(u.pathname);
  } catch { return false; }
}

export function validateImageInput(input: any) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 20000) throw new Error("Escribe un prompt de 1 a 20000 caracteres.");
  const mime = input.image_mime_type;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Selecciona PNG, JPEG o WebP.");
  const b64 = input.image_b64;
  if (typeof b64 !== "string" || !b64.length || b64.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 || b64.length % 4 !== 0) {
    throw new Error("La fotografía debe tener como máximo 8 MiB y base64 válido.");
  }
  let bytes: string;
  try { bytes = atob(b64); } catch { throw new Error("Base64 de imagen inválido."); }
  if (bytes.length > 8 * 1024 * 1024) throw new Error("La fotografía supera 8 MiB.");
  const valid = mime === "image/jpeg" ? bytes.startsWith("\xff\xd8\xff")
    : mime === "image/png" ? bytes.startsWith("\x89PNG\r\n\x1a\n")
    : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("El contenido no corresponde al formato de la fotografía.");
  return { prompt, image_b64: b64, image_mime_type: mime };
}

export async function editKraiImage(endpoint: string, apiKey: string, model: string, input: any) {
  if (!isKraiGateway(endpoint)) throw new Error("Este proveedor no es un Gateway KRAI.");
  if (!apiKey) throw new Error("Falta la clave del proveedor.");
  const validated = validateImageInput(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    // Image edits are not retried automatically: an ambiguous timeout may already
    // have submitted the job to Gemini.
    const res = await fetch(endpoint.replace(/\/+$/, "") + "/execute", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ task: "image_edit", engine_hint: model, input: validated,
        options: { timeout_ms: 60000 }, client_metadata: { request_id: crypto.randomUUID() } }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      const detail = data?.detail || data?.error;
      const message = typeof detail === "string" ? detail : detail?.message || data?.message;
      // Never echo an arbitrary upstream body (it may contain secrets/HTML).
      throw new Error(message ? `KRAI: ${String(message).replaceAll(apiKey, "[oculta]").slice(0, 300)}` : `KRAI respondió HTTP ${res.status}.`);
    }
    const images = (Array.isArray(data?.artifacts) ? data.artifacts : []).filter((a: any) => a?.type === "image");
    if (!images.length) throw new Error("KRAI no devolvió una fotografía editada.");
    const artifacts = images.map((a: any) => {
      validateImageInput({ prompt: "resultado", image_b64: a.data_b64, image_mime_type: a.mime_type });
      return { type: "image", mime_type: a.mime_type, data_b64: a.data_b64,
        ...(Number.isInteger(a.width) ? { width: a.width } : {}),
        ...(Number.isInteger(a.height) ? { height: a.height } : {}) };
    });
    return { ok: true, artifacts };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Tiempo de edición agotado. Comprueba Gemini antes de repetir.");
    throw e;
  } finally { clearTimeout(timer); }
}
