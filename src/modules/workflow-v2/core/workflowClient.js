import { base44 } from "@/api/base44Client";

const MAX_PREVIEW_CHARS = 700000;
const VALID_STATUS = new Set(["TOP_PICK", "SELECT", "REVIEW", "REJECT"]);
const EDIT_LIMITS = Object.freeze({
  Exposure2012: [-2, 2], Contrast2012: [-50, 50], Highlights2012: [-100, 100],
  Shadows2012: [-100, 100], Whites2012: [-100, 100], Blacks2012: [-100, 100],
  Temperature: [-30, 30], Tint: [-30, 30], Vibrance: [-50, 50],
  Saturation: [-30, 30], Clarity2012: [-30, 30], Sharpness: [0, 100],
});

function boundedConfidence(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function safeRecipe(recipe) {
  const confidence = boundedConfidence(recipe?.confidence);
  const values = {};
  for (const [key, limits] of Object.entries(EDIT_LIMITS)) {
    const value = Number(recipe?.values?.[key]);
    if (Number.isFinite(value)) values[key] = Math.max(limits[0], Math.min(limits[1], value));
  }
  return { id: String(recipe?.id || ""), confidence, review: recipe?.review !== false || confidence < 70, values };
}

function safePreview(photo) {
  const dataUrl = photo?.preview?.dataUrl || (photo?.preview?.base64 ? `data:image/jpeg;base64,${photo.preview.base64}` : "");
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_PREVIEW_CHARS) return null;
  return dataUrl;
}

async function invoke(action, mode, payload) {
  const response = await base44.functions.invoke("workflow-v2-engine", { action, mode, ...payload });
  return response?.data ?? response;
}

export async function selectReliable(groups, mode, onProgress) {
  const decisions = new Map();
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const photos = group.photos.map((photo) => ({
      id: photo.id,
      preview: safePreview(photo),
      technical: photo.technical,
    })).filter((photo) => photo.preview);
    if (!photos.length) {
      group.photos.forEach((photo) => decisions.set(photo.id, { status: "REVIEW", confidence: 0, reason: "Vista previa no disponible" }));
    } else {
      try {
        const out = await invoke("select", mode, { burst_id: group.id, photos });
        const valid = new Map((out.decisions || []).map((item) => [String(item.id), item]));
        const normalized = [];
        for (const photo of group.photos) {
          const item = valid.get(photo.id);
          const confidence = boundedConfidence(item?.confidence);
          // Guardia conservadora: una decisión incompleta o poco segura nunca descarta.
          const status = item && confidence >= 70 && VALID_STATUS.has(item.status) ? item.status : "REVIEW";
          normalized.push({ id: photo.id, value: { ...item, status, confidence, reason: item?.reason || "Revisión manual necesaria" } });
        }
        // Una ráfaga solo puede tener una favorita. Si el modelo marca varias,
        // conserva la de mayor confianza y baja las demás a SELECT.
        const tops = normalized.filter((item) => item.value.status === "TOP_PICK").sort((a, b) => b.value.confidence - a.value.confidence);
        normalized.forEach((item) => {
          if (item.value.status === "TOP_PICK" && tops[0]?.id !== item.id) item.value.status = "SELECT";
          decisions.set(item.id, item.value);
        });
      } catch (error) {
        group.photos.forEach((photo) => decisions.set(photo.id, { status: "REVIEW", confidence: 0, reason: `IA no disponible: ${error.message}` }));
      }
    }
    onProgress?.(i + 1, groups.length);
  }
  return decisions;
}

export async function decideBasicEdits(photos, mode, onProgress) {
  const batchSize = mode === "pro" ? 4 : 10;
  const recipes = new Map();
  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize).map((photo) => ({ id: photo.id, preview: safePreview(photo), technical: photo.technical })).filter((p) => p.preview);
    if (!batch.length) continue;
    const out = await invoke("edit", mode, { photos: batch });
    for (const raw of out.recipes || []) {
      const recipe = safeRecipe(raw);
      if (recipe.id && batch.some((photo) => photo.id === recipe.id)) recipes.set(recipe.id, recipe);
    }
    onProgress?.(Math.min(i + batchSize, photos.length), photos.length);
  }
  return recipes;
}

export async function analyzeAlbumSelection(photos, mode) {
  const batch = photos.slice(0, mode === "pro" ? 20 : 12).map((photo) => ({ id: photo.id, preview: safePreview(photo) })).filter((p) => p.preview);
  return invoke("album", mode, { photos: batch });
}
