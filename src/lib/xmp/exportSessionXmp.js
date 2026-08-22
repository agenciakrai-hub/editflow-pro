import { base44 } from "@/api/base44Client";
import { filterAll } from "@/lib/rawaistudio/fetchAll";
import { patchDevelopTags, recipeToTagValues, readTagValue } from "@/lib/xmp/XmpPatchEngine";
import { addRatingAndLabel, validateXmp } from "@/lib/rawaistudio/xmpTagPatcher";
import { lightroomLabelFor } from "@/lib/rawaistudio/labels";
import { buildZip } from "@/lib/zip/zipStore";

const RAW_EXT = /\.(cr3|arw|nef|raf|dng|orf|rw2|pef|srw|raw)$/i;
const baseName = (name) => name.replace(/\.[^.]+$/, "");

// Construye un mapa filename → { selectedByAI, label, rating } desde el estado
// guardado de RAW AI Studio (project.rawai_state.selections). Usa exactamente el
// mismo criterio que el flujo automático (LightroomSyncPanel): una foto está
// seleccionada si selectedForEdit o aiSelected es true. El color verde y las
// estrellas se calculan igual que en el flujo del plugin — así ambos caminos
// producen el mismo XMP.
function selectionMapFromProject(project) {
  const selections = project?.rawai_state?.selections || [];
  const map = new Map();
  for (const s of selections) {
    const isEdit = s.selectedForEdit || s.aiSelected;
    const colorLabel = (s.colorLabel && s.colorLabel !== "none") ? s.colorLabel : (isEdit ? "green" : "none");
    // CRÍTICO: key por base name (lowercase, sin extensión). La selección se guardó
    // con el nombre del RAW (KRFC0785.CR3) pero el archivo XMP que el usuario
    // selecciona en la carpeta se llama KRFC0785.xmp — sin este emparejamiento por
    // base name, selectionMap.get("KRFC0785.xmp") siempre devuelve undefined y
    // NUNCA se escribe xmp:Label="Green".
    const key = baseName(s.filename).toLowerCase();
    map.set(key, {
      filename: s.filename,
      selectedByAI: isEdit,
      label: lightroomLabelFor(colorLabel),
      rating: s.rating || (isEdit ? 5 : 0),
    });
  }
  console.log(`[ExportXmp] selectionMap construido: ${map.size} entradas desde ${selections.length} selections`);
  for (const [key, val] of map) {
    console.log(`[ExportXmp]   selectionMap["${key}"] selectedByAI=${val.selectedByAI} label="${val.label}" rating=${val.rating}`);
  }
  return map;
}

// Aplica xmp:Label="Green" y xmp:Rating al XMP ya parcheado con los develop tags.
// Usa la misma función (addRatingAndLabel) que el flujo automático del navegador
// — ambos caminos producen exactamente los mismos metadatos. Solo las fotos
// seleccionadas por la IA reciben el color verde; las no seleccionadas conservan
// su etiqueta existente. Valida que el XMP final contenga realmente xmp:Label="Green"
// cuando selectedByAI es true — si no, registra un warning en consola.
function applySelectionMetadata(xmpText, filename, selectionMap) {
  // Emparejar por base name (sin extensión, case-insensitive) — el XMP se llama
  // KRFC0785.xmp pero la selección se guardó como KRFC0785.CR3.
  const key = baseName(filename).toLowerCase();
  const sel = selectionMap.get(key) || {};
  const effectiveLabel = sel.selectedByAI ? "Green" : null;
  console.log(`[ExportXmp] filename=${filename}`);
  console.log(`[ExportXmp] baseKey=${key}`);
  console.log(`[ExportXmp] selectedByAI=${!!sel.selectedByAI}`);
  console.log(`[ExportXmp] rating=${sel.rating || 0}`);
  console.log(`[ExportXmp] effectiveLabel=${effectiveLabel || "(none)"}`);
  const finalText = addRatingAndLabel(xmpText, { rating: sel.rating, label: effectiveLabel });
  // Comprobar AMBAS formas (atributo y elemento hijo) porque Lightroom puede
  // escribir xmp:Label y xmp:Rating de cualquiera de las dos maneras.
  const hasRating5 = /xmp:Rating\s*=\s*"5"/.test(finalText) || /<xmp:Rating>5<\/xmp:Rating>/.test(finalText);
  const hasLabelGreen = /xmp:Label\s*=\s*"Green"/.test(finalText) || /<xmp:Label>Green<\/xmp:Label>/.test(finalText);
  console.log(`[ExportXmp] final XMP has Rating 5 = ${hasRating5}`);
  console.log(`[ExportXmp] final XMP has Label Green = ${hasLabelGreen}`);
  if (sel.selectedByAI && !hasLabelGreen) {
    console.error(`[ExportXmp] ERROR: selectedByAI=true pero xmp:Label="Green" NO está en el XMP final`);
  }
  const { valid, issues } = validateXmp(finalText, { rating: sel.rating, label: effectiveLabel, selectedByAI: sel.selectedByAI });
  if (!valid) console.warn(`[ExportXmp] VALIDACIÓN FALLIDA: ${issues.join("; ")}`);
  return finalText;
}

// Lee la carpeta seleccionada (input webkitdirectory) y separa los .xmp de los RAW.
export function readSessionFolder(fileList) {
  const xmps = [];
  let raws = 0;
  for (const f of Array.from(fileList || [])) {
    if (/\.xmp$/i.test(f.name)) xmps.push({ file: f, base: baseName(f.name) });
    else if (RAW_EXT.test(f.name)) raws += 1;
  }
  return { xmps, raws };
}

// Parchea cada XMP con la receta de la escena de su foto y devuelve un ZIP con los
// Yield al hilo de UI: sin esto, procesar 400+ XMP bloquea el main thread durante
// segundos y el navegador se congela (la barra de progreso no repinta). Con un
// setTimeout(0) cada pocos archivos, el browser puede repintar y seguir respondiendo.
const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

// XMP modificados manteniendo los nombres originales. onProgress({done,total}).
export async function exportSessionXmp(projectId, xmpEntries, onProgress, override) {
  // Cargar el proyecto para obtener el estado de selección de la IA. Si no se
  // puede cargar, se continúa sin metadatos de selección (ninguna foto recibe
  // Green — el flujo no falla, simplemente no aplica color).
  const project = await base44.entities.Project.get(projectId).catch(() => null);
  const selectionMap = selectionMapFromProject(project);
  // override = { tagValues } | { recipe } | null.
  //   - tagValues: valores exactos extraídos del preset del estilo → se aplican tal cual.
  //   - recipe: receta generada por la IA → se convierte a tags por archivo (respetando
  //     el balance de blancos existente de cada foto).
  if (override?.tagValues || override?.recipe) {
    const total = xmpEntries.length;
    const entries = [];
    let matched = 0;
    const failed = [];
    for (let i = 0; i < total; i++) {
      const { file } = xmpEntries[i];
      try {
        const text = await file.text();
        let tagValues;
        if (override.tagValues) {
          tagValues = override.tagValues;
        } else {
          const existingTemp = readTagValue(text, "Temperature");
          tagValues = recipeToTagValues(override.recipe, existingTemp);
        }
        const { text: patched } = patchDevelopTags(text, tagValues);
        const finalText = applySelectionMetadata(patched, file.name, selectionMap);
        entries.push({ name: file.name, data: new TextEncoder().encode(finalText) });
        matched++;
      } catch (e) {
        console.error(`[ExportXmp] ERROR en ${file.name}: ${e.message}`);
        failed.push({ name: file.name, error: e.message });
      }
      onProgress?.({ done: i + 1, total });
      // Ceder al hilo de UI cada 3 archivos para que el progreso repinte y el
      // navegador no se congele en lotes grandes (400+ fotos).
      if (i % 3 === 0) await yieldToUI();
    }
    if (!entries.length) throw new Error("No se generó ningún XMP.");
    await yieldToUI();
    return { blob: await buildZip(entries), matched, noImage: 0, noRecipe: 0, count: entries.length, failed };
  }

  const images = await filterAll("Image", { project_id: projectId });
  const byBase = new Map();
  for (const img of images) byBase.set(baseName(img.filename).toLowerCase(), img);

  const recipeCache = {};
  const getRecipe = async (id) => {
    if (!id) return null;
    if (id in recipeCache) return recipeCache[id];
    const r = await base44.entities.SceneRecipe.get(id).catch(() => null);
    recipeCache[id] = r;
    return r;
  };

  const entries = [];
  let matched = 0, noImage = 0, noRecipe = 0;
  const failed = [];
  const total = xmpEntries.length;
  for (let i = 0; i < total; i++) {
    const { file, base } = xmpEntries[i];
    const image = byBase.get(base.toLowerCase());
    if (!image) { noImage++; onProgress?.({ done: i + 1, total }); continue; }
    const recipe = await getRecipe(image.scene_recipe_id);
    if (!recipe) { noRecipe++; onProgress?.({ done: i + 1, total }); continue; }
    try {
      const text = await file.text();
      const existingTemp = readTagValue(text, "Temperature");
      const tagValues = recipeToTagValues(recipe, existingTemp);
      const { text: patched } = patchDevelopTags(text, tagValues);
      const finalText = applySelectionMetadata(patched, file.name, selectionMap);
      entries.push({ name: file.name, data: new TextEncoder().encode(finalText) });
      matched++;
    } catch (e) {
      console.error(`[ExportXmp] ERROR en ${file.name}: ${e.message}`);
      failed.push({ name: file.name, error: e.message });
    }
    onProgress?.({ done: i + 1, total });
    if (i % 3 === 0) await yieldToUI();
  }

  if (!entries.length) {
    throw new Error("No se generó ningún XMP. Comprueba que los nombres coincidan y que la sesión esté preparada.");
  }
  await yieldToUI();
  return { blob: await buildZip(entries), matched, noImage, noRecipe, count: entries.length, failed };
}