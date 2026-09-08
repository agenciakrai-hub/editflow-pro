// Clasifica los modelos de un proveedor (OpenAI-compatible) por CAPACIDAD, según su
// nombre. Cada pestaña de tarea de la tarjeta de proveedor muestra SOLO los modelos
// realmente utilizables para esa tarea (p. ej. marcar un modelo de edición de imagen
// para Selección IA rompe el análisis porque no devuelve texto; y un modelo de vídeo
// no analiza fotos).
const RE_EDIT = /(image-edit|image-gen|qwen-image|wanx|flux|cogview|dall-e|dalle|imagen|hidream|kolors|stable-diffusion|seedream|seededit|ideogram|recraft|grok-2-image|photon|bria)/i;
// Video ANTES que imagen genérica: "wan2.7-video"/"t2v" son vídeo aunque la familia
// "wan" también tenga modelos de imagen ("wan2.7-image").
const RE_VIDEO = /(video|veo|t2v|i2v|kling|hunyuan|svd|stable-video|luma|vidu|seedance|sora|ray-)/i;
const RE_IMAGE_GENERIC = /(image)/i;
const RE_VISION = /(vl|vision|omni|gpt-4o|gpt-4\.1|gpt-4-turbo|claude|gemini|llava|minicpm|moondream|pixtral|deepseek-vl|step-1v|idefics|paligemma|mantis)/i;

// Capacidad de un modelo: "seleccion" (visión: analiza fotos y devuelve texto),
// "edicion" (edita/genera imagen), "video" (genera/edita vídeo) u "otro".
export function modelCapability(name) {
  const m = String(name || "").toLowerCase();
  if (!m) return "otro";
  if (RE_EDIT.test(m)) return "edicion";
  if (RE_VIDEO.test(m)) return "video";
  if (RE_IMAGE_GENERIC.test(m)) return "edicion";
  if (RE_VISION.test(m)) return "seleccion";
  return "otro";
}

// Filtra una lista de modelos dejando solo los de una capacidad dada.
export function modelsForTask(models, task) {
  return (models || []).filter((m) => modelCapability(m) === task);
}