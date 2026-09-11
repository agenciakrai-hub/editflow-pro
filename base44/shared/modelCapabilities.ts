// FUENTE ÚNICA DE VERDAD de capacidades de modelos.
//
// Resuelve capacidades (vision / image_edit / video) desde los metadatos DECLARADOS
// por el proveedor en GET /models. NO usa el nombre del modelo como fuente de verdad
// (no regex sobre el nombre). Si el proveedor no declara capacidades (caso NVIDIA NIM
// verificado: /models devuelve solo {id,object,created,owned_by}) → todos los caps
// quedan a `null` (no verificado) → la UI deshabilita la casilla y ofrece "Probar
// capacidad"; el runtime no ejecuta hasta verificar.
//
// Orden de determinación (regla del administrador):
//   1. METADATOS DECLARADOS por el proveedor (este módulo).
//   2. CAPACIDAD EMPÍRICAMENTE VERIFICADA (acción probe-vision en ai-providers).
//   3. Si ninguna existe → no compatible / casilla deshabilitada.
//
// Esquemas declarados soportados (parseo, no adivinación por nombre):
//   - OpenRouter: architecture.modality = "text" | "text+image->text" | "text->image" | "text->video" ...
//   - OpenAI:     modalities = ["text","images"]; output_modalities
//   - NVIDIA NIM: capabilities.inference = "text-only" | "chat" | "vision" | "image-to-text" (cuando el deployment lo declara)
//   - Genérico:   capabilities.vision (booleano), supported_parameters, etc.

export interface ModelCaps {
  vision: boolean | null;      // true = acepta imagen+texto; false = solo texto; null = no verificado
  image_edit: boolean | null;   // true = genera/edita imagen; null = no verificado
  video: boolean | null;        // true = genera/edita vídeo; null = no verificado
}

export interface ModelMetaEntry {
  id: string;
  caps: ModelCaps;
  source: "declared" | "verified" | "unverified";
  probed_at?: string | null;
  probe_status?: "ok" | "rejected" | "error" | null;
}

// Devuelve true/false cuando el metadato declarado permite confirmar; null cuando no
// hay metadatos (no verificado). NUNCA deduce por el nombre.
export function resolveDeclaredCaps(rawModel: any): ModelCaps {
  const caps: ModelCaps = { vision: null, image_edit: null, video: null };
  if (!rawModel || typeof rawModel !== "object") return caps;

  // --- OpenRouter: architecture.modality ---
  const modalityRaw: string = String(
    rawModel?.architecture?.modality || rawModel?.modality || ""
  ).toLowerCase();
  if (modalityRaw) {
    const arrowIdx = modalityRaw.indexOf("->");
    const inputSide = arrowIdx >= 0 ? modalityRaw.slice(0, arrowIdx) : modalityRaw;
    const outputSide = arrowIdx >= 0 ? modalityRaw.slice(arrowIdx + 2) : "";
    if (/image/.test(inputSide)) caps.vision = true;
    if (/image/.test(outputSide)) caps.image_edit = true;
    if (/video/.test(outputSide)) caps.video = true;
    // "text" o "text->text" sin imagen → confirmado solo-texto
    if (modalityRaw === "text" || modalityRaw === "text->text") {
      caps.vision = false;
      caps.image_edit = false;
      caps.video = false;
    }
  }

  // --- OpenAI: modalities (input) + output_modalities ---
  const inMods: any = rawModel?.modalities || rawModel?.input_modalities;
  if (Array.isArray(inMods) && inMods.length) {
    const ins = inMods.map((m: any) => String(m || "").toLowerCase());
    if (ins.some((s) => s.includes("image") || s.includes("vision"))) caps.vision = true;
    if (ins.length && ins.every((s) => s === "text")) {
      // solo "text" en entrada → sin imagen
      if (caps.vision === null) caps.vision = false;
    }
    const outMods: any = rawModel?.output_modalities;
    if (Array.isArray(outMods) && outMods.length) {
      const outs = outMods.map((m: any) => String(m || "").toLowerCase());
      if (outs.some((s) => s.includes("image"))) caps.image_edit = true;
      if (outs.some((s) => s.includes("video"))) caps.video = true;
    }
  }

  // --- NVIDIA NIM: capabilities.inference (algunos deployments lo declaran) ---
  const capObj: any = rawModel?.capabilities || {};
  const inf: string = String(capObj.inference || capObj.vision || "").toLowerCase();
  if (inf) {
    if (inf.includes("vision") || inf.includes("image")) caps.vision = true;
    if (inf === "text-only" || inf === "chat" || inf === "text") {
      if (caps.vision === null) caps.vision = false;
    }
  }
  if (typeof capObj.vision === "boolean") caps.vision = capObj.vision;
  if (typeof capObj.image === "boolean") caps.image_edit = capObj.image;
  if (typeof capObj.video === "boolean") caps.video = capObj.video;

  return caps;
}

// Construye el array de available_models_meta a partir de los objetos crudos de
// /models. Cada entrada: caps resueltas + source ("declared" si algún cap es
// true/false; "unverified" si todos null) + probe vacío.
export function buildModelsMeta(rawModels: any[]): ModelMetaEntry[] {
  const arr = Array.isArray(rawModels) ? rawModels : [];
  return arr.map((m: any) => {
    const id = String(m?.id || m?.name || "").trim();
    const caps = resolveDeclaredCaps(m);
    const anyDeclared = caps.vision !== null || caps.image_edit !== null || caps.video !== null;
    return {
      id,
      caps,
      source: anyDeclared ? "declared" : "unverified",
      probed_at: null,
      probe_status: null,
    };
  }).filter((e) => e.id);
}

// Tarea → capacidad requerida. Selección/Ajustes/Álbum requieren visión; Edición
// requiere image_edit; Vídeo requiere video.
export function capForTask(task: string): "vision" | "image_edit" | "video" | null {
  if (task === "seleccion" || task === "ajustes" || task === "album") return "vision";
  if (task === "edicion") return "image_edit";
  if (task === "video") return "video";
  return null;
}

// ¿El modelo está verificado como compatible con la tarea? Solo true = compatible.
// false = verificado incompatible; null = no verificado. El runtime bloquea false.
export function isVerifiedCompatible(entry: ModelMetaEntry | null | undefined, task: string): boolean {
  const k = capForTask(task);
  if (!k || !entry) return false;
  return entry.caps?.[k] === true;
}