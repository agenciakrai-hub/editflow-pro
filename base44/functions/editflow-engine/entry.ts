// EditFlow Pro engine — grouped backend function.
// User actions (auth required): export, process, sync, plugin, lr-token, lr-push, lr-stats.
// Plugin actions (token-based, no user session): lr-pending, lr-complete — these are
// called by the native Lightroom plugin over HTTP with the X-LR-Token header.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import JSZip from "npm:jszip@3.10.1";
import { generateXMP, LEEME_TXT } from "../../shared/xmp.ts";

export default async function (req) {
  try {
    const url = new URL(req.url);
    const queryAction = url.searchParams.get("action");
    const method = req.method;
    let body = {};
    if (method !== "GET" && method !== "HEAD") {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = queryAction || body.action;

    // Plugin HTTP actions — no user session (authenticated via X-LR-Token).
    if (action === "lr-pending") return await doLrPending(req);
    if (action === "lr-complete") return await doLrComplete(req, body);
    if (action === "lr-collect-ids") return await doLrCollectIds(req, body);
    if (action === "lr-collect-corrections") return await doLrCollectCorrections(req, body);
    if (action === "lr-list-styles") return await doLrListStyles(req);

    // User-auth actions.
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (action === "export") return await doExport(base44, body);
    if (action === "zip-xmp") return await doZipXmp(body);
    if (action === "process") return await doProcess(base44, body);
    if (action === "sync") return await doSync(base44, body);
    if (action === "plugin") return await doPlugin();
    if (action === "lr-token") return await doLrToken(base44, user);
    if (action === "lr-push") return await doLrPush(base44, user, body);
    if (action === "lr-stats") return await doLrStats(base44, user);
    if (action === "lr-catalog-ids") return await doLrCatalogIds(base44, user);
    if (action === "style-corrections") return await doStyleCorrections(base44, user, body);
    if (action === "seguridad-backup") return await doSeguridadBackup(base44, user);

    return Response.json({ error: "Acción no soportada: " + action }, { status: 400 });
  } catch (error) {
    console.error("editflow-engine error", error?.message || error);
    return Response.json({ error: error?.message || "Error interno" }, { status: 500 });
  }
}

function toDataUrl(uint8) {
  let bin = "";
  for (let i = 0; i < uint8.length; i++) bin += String.fromCharCode(uint8[i]);
  return "data:application/zip;base64," + btoa(bin);
}

// action=export — one .xmp per photo + LEEME.txt bundled in a ZIP (returned as a
// data URL). Registers an ExportJob with a small XMP preview (no binary stored).
async function doExport(base44, body) {
  const photos = await base44.entities.Photo.filter({ project_id: body.projectId });
  const target = body.scope === "selected"
    ? photos.filter((p) => p.culling_status === "selected")
    : photos.filter((p) => p.edit_applied);

  if (!target.length) return Response.json({ error: "No hay fotos para exportar" }, { status: 400 });

  const zip = new JSZip();
  const folder = zip.folder("xmp");
  for (const p of target) {
    const baseName = (p.filename || p.id).replace(/\.[^.]+$/, "");
    folder.file(baseName + ".xmp", generateXMP(p.adjustments, p.filename || p.id, p.adjustments?.cameraProfile));
  }
  folder.file("LEEME.txt", LEEME_TXT);

  const downloadUrl = toDataUrl(await zip.generateAsync({ type: "uint8array" }));
  const preview = target.slice(0, 2)
    .map((p) => `<!-- ${p.filename} -->\n` + generateXMP(p.adjustments, p.filename || p.id, p.adjustments?.cameraProfile))
    .join("\n\n");

  const job = await base44.entities.ExportJob.create({
    project_id: body.projectId,
    project_title: body.projectTitle || "Proyecto",
    status: "completed",
    photo_count: target.length,
    format: "xmp",
    xmp_preview: preview,
  });

  return Response.json({ count: target.length, downloadUrl, preview, jobId: job.id });
}

// action=zip-xmp — builds a ZIP from XMP sidecars generated locally in the
// browser (local-first: RAWs never uploaded, only the tiny XMP text). Returns
// the ZIP as a data URL the browser can download in one click.
async function doZipXmp(body) {
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (!jobs.length) return Response.json({ error: "No hay XMP que empaquetar" }, { status: 400 });
  const zip = new JSZip();
  const folder = zip.folder("xmp");
  for (const j of jobs) {
    const baseName = String(j.filename || "").replace(/\.[^.]+$/, "") || "foto";
    folder.file(baseName + ".xmp", String(j.xmp_content || ""));
  }
  folder.file("LEEME.txt", LEEME_TXT);
  const downloadUrl = toDataUrl(await zip.generateAsync({ type: "uint8array" }));
  return Response.json({ downloadUrl, count: jobs.length });
}

// action=process — pipeline-style job (Editkrfoto structure): reads adjustments
// already saved on each Photo, creates a processing job record and returns a
// summary of the corrections. No recalculation.
async function doProcess(base44, body) {
  const job = await base44.entities.ExportJob.create({
    project_id: body.projectId,
    project_title: body.projectTitle || "Proyecto",
    status: "processing",
    photo_count: 0,
    format: "xmp",
  });

  const photos = await base44.entities.Photo.filter({ project_id: body.projectId });
  const edited = photos.filter((p) => p.edit_applied && p.adjustments);

  const summary = edited.map((p) => {
    const a = p.adjustments;
    return { filename: p.filename, exposure: a.exposure, contrast: a.contrast, temperature: a.temperature, clarity: a.clarity };
  });

  await base44.entities.ExportJob.update(job.id, { status: "completed", photo_count: edited.length });

  return Response.json({ jobId: job.id, status: "completed", processed: edited.length, summary });
}

// action=plugin — package the native Lightroom plugin (4 Lua files + INSTALAR.txt)
// into a ZIP on the fly (Editkrfoto /api/lr/plugin-download style) and return a
// data URL the browser can download.
async function doPlugin() {
  const zip = new JSZip();
  const folder = zip.folder("EditFlowPro.lrplugin");
  folder.file("Info.lua", INFO_LUA);
  folder.file("Settings.lua", SETTINGS_LUA);
  folder.file("Sync.lua", SYNC_LUA);
  folder.file("CollectIds.lua", COLLECT_IDS_LUA);
  folder.file("CollectCorrections.lua", COLLECT_CORRECTIONS_LUA);
  folder.file("json.lua", JSON_LUA);
  folder.file("INSTALAR.txt", INSTALAR_TXT);

  const downloadUrl = toDataUrl(await zip.generateAsync({ type: "uint8array" }));
  return Response.json({ downloadUrl });
}

// action=sync — token-based sync tracker (Editkrfoto db.lr_jobs style). Marks
// pending edited photos as exported and returns pending/completed counts.
async function doSync(base44, body) {
  const photos = await base44.entities.Photo.filter({ project_id: body.projectId });
  const pending = photos.filter((p) => p.edit_applied && p.export_status !== "exported");

  if (pending.length) {
    await base44.entities.Photo.bulkUpdate(pending.map((p) => ({ id: p.id, export_status: "exported" })));
  }

  const completed = photos.filter((p) => p.export_status === "exported").length + pending.length;
  return Response.json({ token: body.token, pending: 0, completed, syncedNow: pending.length });
}

// ---- Lightroom native plugin sync (token-based) ----

async function findToken(base44, token) {
  if (!token) return null;
  const rows = await base44.asServiceRole.entities.LrToken.filter({ token });
  return rows.length ? rows[0] : null;
}

// action=lr-token (user auth) — creates/returns the pairing token for the user.
async function doLrToken(base44, user) {
  const existing = await base44.asServiceRole.entities.LrToken.filter({ user_id: user.id });
  if (existing.length) return Response.json({ token: existing[0].token });
  const token = (crypto.randomUUID().replace(/-/g, "")).slice(0, 24);
  await base44.asServiceRole.entities.LrToken.create({ token, user_id: user.id });
  return Response.json({ token });
}

// action=lr-push (user auth) — uploads XMP sidecars (built locally in the browser)
// to the user's queue, keyed by their pairing token. The Lightroom plugin pulls
// them down later. Replaces any previously pending jobs for the token.
async function doLrPush(base44, user, body) {
  const rows = await base44.asServiceRole.entities.LrToken.filter({ user_id: user.id });
  if (!rows.length) return Response.json({ error: "Genera un token primero (lr-token)" }, { status: 400 });
  const token = rows[0].token;

  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (!jobs.length) return Response.json({ error: "No hay fotos que enviar" }, { status: 400 });

  await base44.asServiceRole.entities.LrJob.deleteMany({ token, status: "pending" });
  const records = jobs.map((j) => ({
    token,
    filename: String(j.filename || ""),
    xmp_content: String(j.xmp_content || ""),
    status: "pending",
  }));
  await base44.asServiceRole.entities.LrJob.bulkCreate(records);
  return Response.json({ pushed: records.length });
}

// action=lr-stats (user auth) — pending/completed counts for the user's token.
async function doLrStats(base44, user) {
  const rows = await base44.asServiceRole.entities.LrToken.filter({ user_id: user.id });
  if (!rows.length) return Response.json({ pending: 0, completed: 0 });
  const token = rows[0].token;
  const jobs = await base44.asServiceRole.entities.LrJob.filter({ token });
  const pending = jobs.filter((j) => j.status === "pending").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  return Response.json({ pending, completed });
}

// action=lr-collect-ids (plugin, X-LR-Token) — el plugin envía los IDs/rutas de TODAS
// las fotos del catálogo activo (LrApplication.activeCatalog()). Se guarda un snapshot
// por token (reemplaza el anterior) para que el módulo de Proyectos pueda desambiguar
// emparejamientos de fingerprint. Nunca modifica el .lrcat: solo lectura vía el SDK de LR.
async function doLrCollectIds(req, body) {
  const base44 = createClientFromRequest(req);
  const token = req.headers.get("X-LR-Token") || "";
  const tok = await findToken(base44, token);
  if (!tok) return Response.json({ error: "Token inválido" }, { status: 401 });

  const photos = Array.isArray(body.photos) ? body.photos : [];
  await base44.asServiceRole.entities.LrCatalogSnapshot.deleteMany({ token });
  await base44.asServiceRole.entities.LrCatalogSnapshot.create({ token, photos_json: JSON.stringify(photos) });
  return Response.json({ stored: photos.length });
}

// action=lr-catalog-ids (user auth) — devuelve el snapshot de IDs de catálogo más reciente
// del usuario, para que el frontend de Proyectos enriquezca sus candidatos re-extraídos.
async function doLrCatalogIds(base44, user) {
  const rows = await base44.asServiceRole.entities.LrToken.filter({ user_id: user.id });
  if (!rows.length) return Response.json({ photos: [] });
  const token = rows[0].token;
  const snaps = await base44.asServiceRole.entities.LrCatalogSnapshot.filter({ token });
  if (!snaps.length) return Response.json({ photos: [] });
  let photos = [];
  try { photos = JSON.parse(snaps[0].photos_json || "[]"); } catch { photos = []; }
  return Response.json({ photos });
}

// action=lr-pending (plugin, X-LR-Token) — returns pending XMP jobs (base64) for
// the token, so the Lua plugin can write sidecars next to matching photos.
async function doLrPending(req) {
  const base44 = createClientFromRequest(req);
  const token = req.headers.get("X-LR-Token") || "";
  const tok = await findToken(base44, token);
  if (!tok) return Response.json({ error: "Token inválido" }, { status: 401 });

  const jobs = await base44.asServiceRole.entities.LrJob.filter({ token, status: "pending" });
  const out = jobs.map((j) => ({
    id: j.id,
    filename: j.filename,
    xmp_b64: btoa(j.xmp_content || ""),
  }));
  return Response.json({ jobs: out });
}

// action=lr-complete (plugin, X-LR-Token) — marks the given job ids as completed.
async function doLrComplete(req, body) {
  const base44 = createClientFromRequest(req);
  const token = req.headers.get("X-LR-Token") || "";
  const tok = await findToken(base44, token);
  if (!tok) return Response.json({ error: "Token inválido" }, { status: 401 });

  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
  if (ids.length) {
    try {
      await base44.asServiceRole.entities.LrJob.bulkUpdate(ids.map((id) => ({ id, status: "completed" })));
    } catch (e) { console.error("lr-complete bulkUpdate", e?.message || e); }
  }
  return Response.json({ completed: ids.length });
}

// ---- Cerebro / aprendizaje ----

// Parámetros básicos de los que se aprende. No incluye parámetros creativos del
// preset (esos pertenecen al motor creativo); solo los técnicos que el fotógrafo
// corrige manualmente en Lightroom.
const LEARNING_TRACKED_PARAMS = [
  "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
  "temperature", "tint", "vibrance", "saturation", "clarity", "texture", "dehaze",
];
// Número de correcciones que se considera "aprendizaje completo" (100 % de volumen).
const LEARNING_FULL_CORRECTIONS = 120;

function roundTo(n, d) { const p = Math.pow(10, d); return Math.round(n * p) / p; }

// Mapa de parámetros aprendidos → atributo crs del XMP. Sirve para recuperar los
// valores iniciales que EditFlow aplicó (guardados en LrJob.xmp_content).
const XMP_ATTR_FOR = {
  exposure: "Exposure2012", contrast: "Contrast2012", highlights: "Highlights2012",
  shadows: "Shadows2012", whites: "Whites2012", blacks: "Blacks2012",
  temperature: "Temperature", tint: "Tint", vibrance: "Vibrance",
  saturation: "Saturation", clarity: "Clarity2012", texture: "Texture2012",
  dehaze: "Dehaze2012",
};
function parseInitialValuesFromXmp(xmp) {
  const out = {};
  const text = String(xmp || "");
  for (const [lk, attr] of Object.entries(XMP_ATTR_FOR)) {
    const m = new RegExp("crs:" + attr + '="(-?\\d+(?:\\.\\d+)?)"').exec(text);
    if (m) out[lk] = parseFloat(m[1]);
  }
  if (out.dehaze === undefined) {
    const m = /crs:Dehaze="(-?\d+(?:\.\d+)?)"/.exec(text);
    if (m) out.dehaze = parseFloat(m[1]);
  }
  return out;
}

// action=lr-list-styles (plugin, X-LR-Token) — devuelve los estilos del usuario para
// que el plugin muestre un selector y el fotógrafo indique a qué estilo pertenecen las
// correcciones (asignación explícita, nunca silenciosa).
async function doLrListStyles(req) {
  const base44 = createClientFromRequest(req);
  const token = req.headers.get("X-LR-Token") || "";
  const tok = await findToken(base44, token);
  if (!tok) return Response.json({ error: "Token inválido" }, { status: 401 });
  const all = await base44.asServiceRole.entities.PhotographerStyle.list("-created_date", 200);
  const mine = (Array.isArray(all) ? all : []).filter((s) => s.created_by_id === tok.user_id);
  const out = mine.map((s) => ({
    id: s.id, name: s.name, preset_id: s.preset_id || "", preset_name: s.preset_name || "",
    learning_percentage: s.learning_percentage || 0, photos_processed: s.photos_processed || 0,
  }));
  return Response.json({ styles: out });
}

// Recalcula el resumen de aprendizaje de un estilo a partir de TODAS sus correcciones
// registradas. Fórmula del porcentaje:
//   learning = 100 * volumeFactor * (0.4 + 0.6 * coverageFactor)
//   volumeFactor   = min(1, correction_count / 120)  — cuántas correcciones hay
//   coverageFactor = params corregidos / total tracked — cuántos parámetros distintos
// Una corrección aislada mueve el porcentaje < 1 % (no cambia drásticamente el estilo).
// confidence: low <25 %, medium 25-60 %, high >60 %.
async function recomputeStyleLearning(base44, styleId) {
  const records = await base44.asServiceRole.entities.StyleCorrectionRecord.filter({ style_id: styleId });
  const sumBy = {};
  const correctedParams = new Set();
  for (const r of records) {
    const d = r.delta || {};
    for (const k of LEARNING_TRACKED_PARAMS) {
      if (typeof d[k] === "number") {
        correctedParams.add(k);
        if (!sumBy[k]) sumBy[k] = { sum: 0, count: 0 };
        sumBy[k].sum += d[k];
        sumBy[k].count += 1;
      }
    }
  }
  const corrections_summary = {};
  for (const k of Object.keys(sumBy)) {
    corrections_summary[k] = { mean: roundTo(sumBy[k].sum / sumBy[k].count, 2), count: sumBy[k].count };
  }
  const correction_count = records.length;
  const volumeFactor = Math.min(1, correction_count / LEARNING_FULL_CORRECTIONS);
  const coverageFactor = LEARNING_TRACKED_PARAMS.length ? correctedParams.size / LEARNING_TRACKED_PARAMS.length : 0;
  const learning_percentage = Math.round(100 * volumeFactor * (0.4 + 0.6 * coverageFactor));
  const confidence = learning_percentage >= 60 ? "high" : learning_percentage >= 25 ? "medium" : "low";
  await base44.asServiceRole.entities.PhotographerStyle.update(styleId, {
    correction_count,
    corrections_summary,
    learning_percentage,
    confidence,
    last_sync: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  });
}

// action=lr-collect-corrections (plugin, X-LR-Token) — el plugin envía las correcciones
// reales que el fotógrafo hizo en Lightroom sobre fotos procesadas por EditFlow. Los
// valores iniciales NO los envía el plugin: se recuperan del LrJob (el XMP que EditFlow
// empujó antes vía lr-push), fuente fiable anterior a la corrección. La foto se
// identifica por token + filename (insensible a mayúsculas); 0 coincidencias o >1
// (ambigua) → se descarta, nunca se resuelve silenciosamente. Se cruza con el snapshot
// de catálogo (localId) si está disponible. Valida estilo + preset. No toca motores.
async function doLrCollectCorrections(req, body) {
  const base44 = createClientFromRequest(req);
  const token = req.headers.get("X-LR-Token") || "";
  const tok = await findToken(base44, token);
  if (!tok) return Response.json({ error: "Token inválido" }, { status: 401 });

  const styleId = String(body.style_id || "");
  const presetId = String(body.preset_id || "");
  if (!styleId) return Response.json({ error: "Falta style_id" }, { status: 400 });

  let style;
  try { style = await base44.asServiceRole.entities.PhotographerStyle.get(styleId); }
  catch { return Response.json({ error: "Estilo no encontrado" }, { status: 404 }); }
  if (!style || style.created_by_id !== tok.user_id) return Response.json({ error: "Estilo no válido para este token" }, { status: 403 });
  if (presetId && style.preset_id && presetId !== style.preset_id) return Response.json({ error: "El preset no coincide con el estilo" }, { status: 400 });

  // Snapshot de catálogo: auditoría de identificación por localId.
  const snaps = await base44.asServiceRole.entities.LrCatalogSnapshot.filter({ token });
  let snapByFilename = {};
  if (snaps.length) {
    let arr = []; try { arr = JSON.parse(snaps[0].photos_json || "[]"); } catch { arr = []; }
    for (const p of arr) snapByFilename[String(p.fileName || "").toLowerCase()] = p;
  }

  // LrJob: fuente de los valores iniciales (XMP que EditFlow empujó). Para evitar que
  // trabajos antiguos del mismo archivo provoquen coincidencias ambiguas, nos quedamos
  // solo con el MÁS RELEVANTE por filename: el último completado (el que realmente se
  // escribió en Lightroom) y, si no hay ninguno completado, el último pendiente. No se
  // borra ningún LrJob: solo se acota la búsqueda.
  const allJobs = await base44.asServiceRole.entities.LrJob.filter({ token });
  const jobsByFilename = {};
  const sortedJobs = [...allJobs].sort((a, b) => {
    const ca = a.status === "completed" ? 1 : 0;
    const cb = b.status === "completed" ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0);
  });
  for (const j of sortedJobs) {
    const key = String(j.filename || "").toLowerCase();
    if (!key) continue;
    if (!jobsByFilename[key]) jobsByFilename[key] = j;
  }

  // Idempotencia: una misma corrección de una misma foto en el mismo estilo no debe
  // duplicarse. Clave estable = style_id + (localId || photo_fingerprint_id). Si ya
  // existe un registro para esa clave (en BD o ya creado en este lote), se actualiza
  // en lugar de crear uno nuevo, por lo que correction_count y learning_percentage no
  // se inflan al reenviar la misma corrección.
  const existingRecords = await base44.asServiceRole.entities.StyleCorrectionRecord.filter({ style_id: styleId });
  const recordByKey = {};
  for (const r of existingRecords) {
    const k = String(r.photo_fingerprint_id || "").toLowerCase();
    if (k) recordByKey[k] = r;
  }

  const corrections = Array.isArray(body.corrections) ? body.corrections : [];
  let stored = 0, updated = 0, rejected = 0;
  const seenCreated = {};
  for (const c of corrections) {
    const filename = String(c.filename || "").toLowerCase();
    if (!filename) { rejected++; continue; }
    // Identificación: snapshot localId (si existe) debe coincidir.
    const snap = snapByFilename[filename];
    if (snap && snap.localId && c.localId && String(snap.localId) !== String(c.localId)) {
      rejected++; continue;
    }
    const job = jobsByFilename[filename];
    if (!job) { rejected++; continue; }   // sin inicial conocido
    const initial = parseInitialValuesFromXmp(job.xmp_content);
    const current = c.current_values || c.corrected_values || {};
    const delta = {};
    for (const k of LEARNING_TRACKED_PARAMS) {
      if (typeof initial[k] === "number" && typeof current[k] === "number") {
        delta[k] = roundTo(current[k] - initial[k], 2);
      }
    }
    if (!Object.keys(delta).length) { rejected++; continue; } // nada que aprender
    const fpId = String(c.localId || c.photo_fingerprint_id || "");
    const dedupKey = fpId.toLowerCase();
    const prev = dedupKey ? recordByKey[dedupKey] : null;
    const prevInBatch = dedupKey ? seenCreated[dedupKey] : null;
    if (prev) {
      await base44.asServiceRole.entities.StyleCorrectionRecord.update(prev.id, {
        initial_values: initial, corrected_values: current, delta,
      });
      updated++;
    } else if (prevInBatch) {
      await base44.asServiceRole.entities.StyleCorrectionRecord.update(prevInBatch, {
        initial_values: initial, corrected_values: current, delta,
      });
      updated++;
    } else {
      const created = await base44.asServiceRole.entities.StyleCorrectionRecord.create({
        style_id: styleId,
        preset_id: presetId || style.preset_id || "",
        photo_fingerprint_id: fpId,
        initial_values: initial,
        corrected_values: current,
        delta,
      });
      if (dedupKey) seenCreated[dedupKey] = created.id;
      stored++;
    }
  }
  let updatedPct = style.learning_percentage || 0;
  if (stored > 0 || updated > 0) {
    try {
      await recomputeStyleLearning(base44, styleId);
      const refreshed = await base44.asServiceRole.entities.PhotographerStyle.get(styleId);
      updatedPct = refreshed?.learning_percentage ?? updatedPct;
    } catch (e) { console.error("recompute learning", styleId, e?.message || e); }
  }
  return Response.json({
    stored, updated, rejected,
    analyzed: corrections.length,
    style_name: style.name,
    learning_percentage: updatedPct,
  });
}

// action=style-corrections (user auth) — devuelve el historial de correcciones de un
// estilo (vía asServiceRole) para que el frontend de Cerebro lo muestre. Valida que el
// estilo pertenezca al usuario.
async function doStyleCorrections(base44, user, body) {
  const styleId = String(body.style_id || "");
  if (!styleId) return Response.json({ corrections: [] });
  let style;
  try { style = await base44.entities.PhotographerStyle.get(styleId); }
  catch { return Response.json({ corrections: [] }); }
  if (!style || style.created_by_id !== user.id) return Response.json({ corrections: [] });
  const records = await base44.asServiceRole.entities.StyleCorrectionRecord.filter({ style_id: styleId });
  return Response.json({ corrections: records });
}

// ---- Lua plugin sources (backslash-free; safe inside TS template literals) ----

const INFO_LUA = `return {
    LrSdkVersion = 12.0,
    LrSdkMinimumVersion = 6.0,
    LrToolkitIdentifier = "com.editflowpro.sync",
    LrPluginName = "EditFlow Pro",
    VERSION = { major = 1, minor = 1, revision = 0 },
    LrExportMenuItems = {
        { title = "EditFlow Pro: Sincronizar seleccionadas", file = "Sync.lua" },
        { title = "EditFlow Pro: Recopilar IDs de catálogo", file = "CollectIds.lua" },
        { title = "EditFlow Pro: 🧠 Recopilar correcciones", file = "CollectCorrections.lua" },
        { title = "EditFlow Pro: Configurar (token)", file = "Settings.lua" },
    },
    LrLibraryMenuItems = {
        { title = "EditFlow Pro: Sincronizar seleccionadas", file = "Sync.lua" },
        { title = "EditFlow Pro: Recopilar IDs de catálogo", file = "CollectIds.lua" },
        { title = "EditFlow Pro: 🧠 Recopilar correcciones", file = "CollectCorrections.lua" },
        { title = "EditFlow Pro: Configurar (token)", file = "Settings.lua" },
    },
}
`;

const SETTINGS_LUA = `local LrDialogs = import "LrDialogs"
local LrView = import "LrView"
local LrPrefs = import "LrPrefs"
local LrFunctionContext = import "LrFunctionContext"
local LrBinding = import "LrBinding"

local prefs = LrPrefs.prefsForPlugin()

LrFunctionContext.callWithContext("editflow_settings", function(context)
    local f = LrView.osFactory()
    local bindable = LrBinding.makePropertyTable(context)
    bindable.baseUrl = prefs.baseUrl or ""
    bindable.token = prefs.token or ""

    local c = f:column {
        bind_to_object = bindable,
        spacing = f:control_spacing(),
        f:static_text { title = "URL del servidor EditFlow Pro (cópiala de la web):" },
        f:edit_field { value = LrView.bind("baseUrl"), width_in_chars = 48 },
        f:static_text { title = "Token de emparejamiento (cópialo de la web):" },
        f:edit_field { value = LrView.bind("token"), width_in_chars = 40 },
    }

    local res = LrDialogs.presentModalDialog {
        title = "EditFlow Pro - Configuración",
        contents = c,
    }
    if res == "ok" then
        prefs.baseUrl = bindable.baseUrl
        prefs.token = bindable.token
        LrDialogs.message("EditFlow Pro", "Configuración guardada.", "info")
    end
end)
`;

const SYNC_LUA = `local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrPrefs = import "LrPrefs"
local LrTasks = import "LrTasks"
local LrPathUtils = import "LrPathUtils"
local LrFunctionContext = import "LrFunctionContext"
local LrProgressScope = import "LrProgressScope"

local prefs = LrPrefs.prefsForPlugin()
local JSON = require "json"

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64dec(s)
    if not s or s == "" then return "" end
    local rev = {}
    for i = 1, #B64 do rev[B64:sub(i, i)] = i - 1 end
    local t = {}
    for c in s:gmatch("[^=]") do t[#t + 1] = rev[c] or 0 end
    local out = {}
    for i = 1, #t, 4 do
        local n = (t[i] or 0) * 262144 + (t[i + 1] or 0) * 4096 + (t[i + 2] or 0) * 64 + (t[i + 3] or 0)
        out[#out + 1] = string.char(math.floor(n / 65536) % 256)
        out[#out + 1] = string.char(math.floor(n / 256) % 256)
        out[#out + 1] = string.char(n % 256)
    end
    local pad = 0
    if s:sub(-1) == "=" then pad = 1 end
    if #s >= 2 and s:sub(-2, -2) == "=" then pad = 2 end
    for _ = 1, pad do out[#out] = nil end
    return table.concat(out)
end

local function apiCall(action, body)
    local base = (prefs.baseUrl or ""):gsub("/+$", "")
    if base == "" then return nil end
    local url = base .. "/api/functions/editflow-engine?action=" .. action
    local headers = {
        { field = "Content-Type", value = "application/json" },
        { field = "X-LR-Token", value = prefs.token or "" },
    }
    local resp = LrHttp.post(url, body or "{}", headers)
    return resp
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("editflow_sync", function(context)
        if not prefs.token or prefs.token == "" then
            LrDialogs.message("EditFlow Pro", "Configura primero el token (menú: Configurar).", "warning")
            return
        end
        if not prefs.baseUrl or prefs.baseUrl == "" then
            LrDialogs.message("EditFlow Pro", "Configura primero la URL del servidor (menú: Configurar).", "warning")
            return
        end
        local catalog = LrApplication.activeCatalog()
        local photos = catalog:getTargetPhotos()
        if #photos == 0 then
            LrDialogs.message("EditFlow Pro", "Selecciona al menos una foto.", "warning")
            return
        end

        local raw = apiCall("lr-pending")
        if not raw then
            LrDialogs.message("EditFlow Pro", "No se pudo conectar con el servidor. Revisa URL y token.", "error")
            return
        end
        local ok, data = pcall(function() return JSON.decode(raw) end)
        if not ok or not data or not data.jobs then
            LrDialogs.message("EditFlow Pro", "Respuesta inválida del servidor.", "error")
            return
        end

        local byName = {}
        for _, job in ipairs(data.jobs) do
            byName[(job.filename or ""):lower()] = job
        end

        local progress = LrProgressScope { title = "EditFlow Pro: sincronizando..." }
        local applied, missing, doneIds = 0, 0, {}

        for i, photo in ipairs(photos) do
            local name = (photo:getFormattedMetadata("fileName") or ""):lower()
            local job = byName[name]
            if job and job.xmp_b64 then
                local rawPath = photo:getRawMetadata("path")
                if rawPath then
                    local dir = LrPathUtils.parent(rawPath)
                    local baseNoExt = LrPathUtils.removeExtension(LrPathUtils.leafName(rawPath))
                    local xmpPath = LrPathUtils.child(dir, baseNoExt .. ".xmp")
                    local fh = io.open(xmpPath, "w")
                    if fh then
                        fh:write(b64dec(job.xmp_b64))
                        fh:close()
                        catalog:withWriteAccessDo("readMeta", function()
                            photo:readMetadata()
                        end, { timeout = 30 })
                        applied = applied + 1
                        doneIds[#doneIds + 1] = job.id
                    end
                end
            else
                missing = missing + 1
            end
            progress:setPortionComplete(i, #photos)
            if progress:isCanceled() then break end
        end
        progress:done()

        if #doneIds > 0 then
            apiCall("lr-complete", '{"ids":["' .. table.concat(doneIds, '","') .. '"]}')
        end

        LrDialogs.message("EditFlow Pro",
            "Aplicadas: " .. applied .. "  |  Sin coincidencia: " .. missing ..
            "\\n\\nNota: en DNG, Lightroom lee el XMP incrustado; los sidecar .xmp funcionan en RAW nativos (CR3/NEF/ARW).",
            "info")
    end)
end)
`;

const COLLECT_IDS_LUA = `local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrPrefs = import "LrPrefs"
local LrTasks = import "LrTasks"
local LrFileUtils = import "LrFileUtils"
local LrFunctionContext = import "LrFunctionContext"
local LrProgressScope = import "LrProgressScope"

local prefs = LrPrefs.prefsForPlugin()

local function jsonEscape(s)
    s = tostring(s or "")
    local BS = string.char(92)
    s = s:gsub(BS, BS .. BS)
    s = s:gsub('"', BS .. '"')
    s = s:gsub('%c', ' ')
    return s
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("editflow_collect_ids", function(context)
        if not prefs.token or prefs.token == "" then
            LrDialogs.message("EditFlow Pro", "Configura primero el token (menú: Configurar).", "warning")
            return
        end
        if not prefs.baseUrl or prefs.baseUrl == "" then
            LrDialogs.message("EditFlow Pro", "Configura primero la URL del servidor (menú: Configurar).", "warning")
            return
        end
        local catalog = LrApplication.activeCatalog()
        local photos = catalog:getAllPhotos()
        local progress = LrProgressScope { title = "EditFlow Pro: recopilando IDs del catálogo..." }
        local parts = {}
        for i, photo in ipairs(photos) do
            local path = photo:getRawMetadata("path") or ""
            local fileName = photo:getFormattedMetadata("fileName") or ""
            local captureTime = photo:getFormattedMetadata("dateTimeOriginalISO8601") or ""
            local cameraMake = photo:getFormattedMetadata("cameraMake") or ""
            local cameraModel = photo:getFormattedMetadata("cameraModel") or ""
            local fileSize = 0
            local ok, attrs = pcall(function() return LrFileUtils.fileAttributes(path) end)
            if ok and attrs and attrs.fileSize then fileSize = attrs.fileSize end
            local localId = tostring(photo.localIdentifier)
            parts[#parts + 1] = string.format(
                '{"localId":"%s","fileName":"%s","path":"%s","captureTime":"%s","cameraMake":"%s","cameraModel":"%s","fileSize":%d}',
                jsonEscape(localId), jsonEscape(fileName), jsonEscape(path), jsonEscape(captureTime),
                jsonEscape(cameraMake), jsonEscape(cameraModel), fileSize
            )
            progress:setPortionComplete(i, #photos)
            if progress:isCanceled() then break end
        end
        progress:done()

        local body = '{"photos":[' .. table.concat(parts, ",") .. ']}'
        local base = (prefs.baseUrl or ""):gsub("/+$", "")
        local url = base .. "/api/functions/editflow-engine?action=lr-collect-ids"
        local headers = {
            { field = "Content-Type", value = "application/json" },
            { field = "X-LR-Token", value = prefs.token or "" },
        }
        local resp = LrHttp.post(url, body, headers)
        if resp then
            LrDialogs.message("EditFlow Pro", "IDs de catálogo enviados: " .. #parts .. " fotos.", "info")
        else
            LrDialogs.message("EditFlow Pro", "No se pudo conectar con el servidor.", "error")
        end
    end)
end)
`;

const COLLECT_CORRECTIONS_LUA = `local LrApplication = import "LrApplication"
local LrDialogs = import "LrDialogs"
local LrHttp = import "LrHttp"
local LrPrefs = import "LrPrefs"
local LrTasks = import "LrTasks"
local LrView = import "LrView"
local LrBinding = import "LrBinding"
local LrFunctionContext = import "LrFunctionContext"
local LrFileUtils = import "LrFileUtils"
local LrProgressScope = import "LrProgressScope"

local prefs = LrPrefs.prefsForPlugin()
local JSON = require "json"

-- Mapeo de claves de getDevelopSettings a los parámetros aprendidos (minúsculas).
local MAP = {
  Exposure2012 = "exposure", Contrast2012 = "contrast", Highlights2012 = "highlights",
  Shadows2012 = "shadows", Whites2012 = "whites", Blacks2012 = "blacks",
  Temperature = "temperature", Tint = "tint", Vibrance = "vibrance",
  Saturation = "saturation", Clarity2012 = "clarity", Texture2012 = "texture",
  Dehaze2012 = "dehaze", Dehaze = "dehaze",
}

local function apiCall(action, body)
    local base = (prefs.baseUrl or ""):gsub("/+$", "")
    if base == "" then return nil end
    local url = base .. "/api/functions/editflow-engine?action=" .. action
    local headers = {
        { field = "Content-Type", value = "application/json" },
        { field = "X-LR-Token", value = prefs.token or "" },
    }
    return LrHttp.post(url, body or "{}", headers)
end

local function jstr(s)
    s = tostring(s or "")
    local BS = string.char(92)
    s = s:gsub(BS, BS .. BS)
    s = s:gsub('"', BS .. '"')
    s = s:gsub('%c', ' ')
    return '"' .. s .. '"'
end

local function jnum(n)
    if n == nil then return "null" end
    if type(n) ~= "number" then n = tonumber(n) or 0 end
    local s = string.format("%.4f", n)
    s = s:gsub("0+$", "")
    s = s:gsub("%.$", "")
    return s
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("editflow_collect_corrections", function(context)
        if not prefs.token or prefs.token == "" then
            LrDialogs.message("EditFlow Pro", "Configura primero el token (menú: Configurar).", "warning")
            return
        end
        if not prefs.baseUrl or prefs.baseUrl == "" then
            LrDialogs.message("EditFlow Pro", "Configura primero la URL del servidor (menú: Configurar).", "warning")
            return
        end

        -- 1) Pedir la lista de estilos del usuario.
        local raw = apiCall("lr-list-styles")
        if not raw then
            LrDialogs.message("EditFlow Pro", "No se pudo conectar con el servidor. Revisa URL y token.", "error")
            return
        end
        local ok, data = pcall(function() return JSON.decode(raw) end)
        if not ok or not data or not data.styles or #data.styles == 0 then
            LrDialogs.message("EditFlow Pro", "No tienes estilos guardados. Procesa fotos con un preset de Cerebro primero.", "warning")
            return
        end

        -- 2) Diálogo para seleccionar el estilo al que pertenecen las correcciones.
        local bindable = LrBinding.makePropertyTable(context)
        bindable.styleIndex = 1
        local f = LrView.osFactory()
        local items = {}
        for i, s in ipairs(data.styles) do
            items[i] = s.name .. "  (" .. (s.learning_percentage or 0) .. "%)"
        end
        local contents = f:column {
            bind_to_object = bindable,
            spacing = f:control_spacing(),
            f:static_text { title = "Selecciona el estilo al que pertenecen las correcciones:" },
            f:popup_menu { value = LrView.bind("styleIndex"), items = items },
        }
        local res = LrDialogs.presentModalDialog {
            title = "EditFlow Pro - Recopilar correcciones",
            contents = contents,
        }
        if res ~= "ok" then return end
        local selectedStyle = data.styles[bindable.styleIndex] or data.styles[1]
        if not selectedStyle then return end

        -- 3) Recopilar correcciones de las fotos seleccionadas.
        local catalog = LrApplication.activeCatalog()
        local photos = catalog:getTargetPhotos()
        if #photos == 0 then
            LrDialogs.message("EditFlow Pro", "Selecciona al menos una foto corregida.", "warning")
            return
        end

        local progress = LrProgressScope { title = "EditFlow Pro: recopilando correcciones..." }
        local parts = {}
        for i, photo in ipairs(photos) do
            local fileName = photo:getFormattedMetadata("fileName") or ""
            local localId = tostring(photo.localIdentifier)
            local captureTime = photo:getFormattedMetadata("dateTimeOriginalISO8601") or ""
            local cameraMake = photo:getFormattedMetadata("cameraMake") or ""
            local cameraModel = photo:getFormattedMetadata("cameraModel") or ""
            local path = photo:getRawMetadata("path") or ""
            local fileSize = 0
            local okA, attrs = pcall(function() return LrFileUtils.fileAttributes(path) end)
            if okA and attrs and attrs.fileSize then fileSize = attrs.fileSize end
            local settings = photo:getDevelopSettings()
            local cvParts = {}
            for lrKey, lk in pairs(MAP) do
                if settings[lrKey] ~= nil then
                    cvParts[#cvParts + 1] = '"' .. lk .. '":' .. jnum(settings[lrKey])
                end
            end
            parts[#parts + 1] = '{"filename":' .. jstr(fileName)
                .. ',"localId":' .. jstr(localId)
                .. ',"captureTime":' .. jstr(captureTime)
                .. ',"cameraMake":' .. jstr(cameraMake)
                .. ',"cameraModel":' .. jstr(cameraModel)
                .. ',"fileSize":' .. tostring(fileSize)
                .. ',"current_values":{' .. table.concat(cvParts, ",") .. '}}'
            progress:setPortionComplete(i, #photos)
            if progress:isCanceled() then break end
        end
        progress:done()

        local body = '{"style_id":' .. jstr(selectedStyle.id)
            .. ',"preset_id":' .. jstr(selectedStyle.preset_id or "")
            .. ',"corrections":[' .. table.concat(parts, ",") .. ']}'
        local resp = apiCall("lr-collect-corrections", body)
        local stored, rejected, analyzed, pct, sname = 0, 0, #photos, 0, selectedStyle.name or ""
        if resp then
            local okR, rdata = pcall(function() return JSON.decode(resp) end)
            if okR and rdata then
                stored = rdata.stored or 0
                rejected = rdata.rejected or 0
                analyzed = rdata.analyzed or #photos
                pct = rdata.learning_percentage or 0
                sname = rdata.style_name or sname
            end
        end
        LrDialogs.message("EditFlow Pro",
            "🧠 Aprendizaje sincronizado\\n\\n" ..
            "Estilo: " .. sname .. "\\n" ..
            "Fotografías analizadas: " .. analyzed .. "\\n" ..
            "Correcciones encontradas: " .. stored .. "\\n" ..
            "Correcciones enviadas: " .. stored .. "\\n" ..
            "Aprendizaje actual: " .. pct .. " %\\n\\n" ..
            "Solo se envían metadatos y valores numéricos. Nunca se suben RAW ni fotos.",
            "info")
    end)
end)
`;

const JSON_LUA = `-- json.lua - minimal JSON decoder for the EditFlow Pro Lightroom plugin.
-- Strings here carry no escapes (ids, filenames and base64 only), so this decoder
-- does not implement backslash unescaping.
local json = {}

local function skip(s, p)
    while p <= #s and s:sub(p, p):match("%s") do p = p + 1 end
    return p
end

local function parse(s, p)
    p = skip(s, p)
    local c = s:sub(p, p)
    if c == "{" then
        p = p + 1
        local obj = {}
        p = skip(s, p)
        if s:sub(p, p) == "}" then return obj, p + 1 end
        while true do
            p = skip(s, p)
            if s:sub(p, p) ~= '"' then error("json: expected key string") end
            p = p + 1
            local ks = p
            while s:sub(p, p) ~= '"' do p = p + 1 end
            local key = s:sub(ks, p - 1)
            p = p + 1
            p = skip(s, p)
            if s:sub(p, p) ~= ":" then error("json: expected colon") end
            p = p + 1
            local val
            val, p = parse(s, p)
            obj[key] = val
            p = skip(s, p)
            local sep = s:sub(p, p)
            if sep == "," then p = p + 1
            elseif sep == "}" then return obj, p + 1
            else error("json: expected comma or }") end
        end
    elseif c == "[" then
        p = p + 1
        local arr = {}
        p = skip(s, p)
        if s:sub(p, p) == "]" then return arr, p + 1 end
        while true do
            local val
            val, p = parse(s, p)
            arr[#arr + 1] = val
            p = skip(s, p)
            local sep = s:sub(p, p)
            if sep == "," then p = p + 1
            elseif sep == "]" then return arr, p + 1
            else error("json: expected comma or ]") end
        end
    elseif c == '"' then
        p = p + 1
        local ks = p
        while s:sub(p, p) ~= '"' do p = p + 1 end
        local str = s:sub(ks, p - 1)
        return str, p + 1
    elseif c == "t" then
        return true, p + 4
    elseif c == "f" then
        return false, p + 5
    elseif c == "n" then
        return nil, p + 4
    else
        local num = s:match("^%-?%d+%.?%d*[eE]?[+-]?%d*", p)
        if not num then error("json: unexpected char " .. tostring(c)) end
        return tonumber(num), p + #num
    end
end

function json.decode(s)
    local v = parse(s, 1)
    return v
end

return json
`;

const INSTALAR_TXT = `EditFlow Pro - Plugin nativo para Adobe Lightroom Classic
=========================================================

INSTALACION (una sola vez)
--------------------------
1. Descomprime este archivo .zip. Obtendras la carpeta:
       EditFlowPro.lrplugin
2. Abre Lightroom Classic.
3. Menu: Archivo > Administrador de plugins (File > Plug-in Manager).
4. Pulsa "Agregar" (Add) y selecciona la carpeta EditFlowPro.lrplugin.
5. Pulsa "Listo" (Done).

CONFIGURACION (token + URL)
--------------------------
1. Entra en la web de EditFlow Pro, seccion "Lightroom".
2. Copia tu TOKEN de emparejamiento y la URL del servidor (la URL de la web).
3. En Lightroom: menu "EditFlow Pro: Configurar (token)".
4. Pega la URL del servidor y el token. Guarda.

USO
---
1. En la web pulsa "Enviar a Lightroom" (sube los XMP generados a tu cola).
2. En Lightroom Classic selecciona las fotos correspondientes (mismo nombre de archivo).
3. Menu: "EditFlow Pro: Sincronizar seleccionadas".
4. El plugin descarga los ajustes y escribe un sidecar .xmp junto a cada foto.

NOTA sobre formatos
-------------------
- En RAW nativos (CR3, NEF, ARW) el plugin escribe un sidecar .xmp junto a la foto.
- En DNG, Lightroom lee el XMP incrustado; si no ves cambios, usa "Leer metadatos del archivo".

ACTUALIZACION DEL PLUGIN
------------------------
Si actualizaste el plugin y no aparecen las nuevas acciones (p. ej. "Recopilar
correcciones"):
1. Sustituye la carpeta EditFlowPro.lrplugin por la nueva (descomprime el ZIP nuevo).
2. En Lightroom Classic: Archivo > Administrador de plugins, selecciona EditFlow Pro y
   pulsa "Recargar" (Reload).
3. IMPORTANTE: las nuevas acciones de menu solo se registran al REINICIAR Lightroom
   Classic. Cierra y vuelve a abrir Lightroom para que aparezcan.
4. Verifica la version en el Administrador de plugins (debe ser 1.1 o superior).
`;

// action=seguridad-backup — vuelca TODAS las entidades del usuario a un JSON y lo sube
// a almacenamiento, devolviendo una URL de descarga. Punto de control "SEGURIDAD 1":
// captura el estado completo de datos guardados hasta la fecha de ejecucion.
async function doSeguridadBackup(base44, user) {
  const entities = [
    "Project", "ProjectPhotoFingerprint", "PresetRegistry", "PhotographerStyle",
    "Preset", "ExportJob", "CatalogBinding", "PhotographerStyleProfile",
    "StyleCorrectionRecord", "ProjectProcessingJob", "Base44Purchase",
    "AiProviderConfig", "CustomAiProvider", "LrJob", "LrToken", "LrCatalogSnapshot",
  ];
  const ts = new Date().toISOString();
  const dump = { checkpoint: "SEGURIDAD-1", generated_at: ts, generated_by: user?.id || null, counts: {}, data: {} };
  for (const e of entities) {
    try {
      const list = await base44.asServiceRole.entities[e].list();
      dump.data[e] = Array.isArray(list) ? list : [];
      dump.counts[e] = dump.data[e].length;
    } catch (err) {
      dump.data[e] = { error: err?.message || "denied" };
      dump.counts[e] = -1;
    }
  }
  const json = JSON.stringify(dump, null, 2);
  const filename = `SEGURIDAD-1-backup-${ts.slice(0, 10)}.json`;
  let downloadUrl = null;
  try {
    const blob = new Blob([json], { type: "application/json" });
    const file = new File([blob], filename, { type: "application/json" });
    const res = await base44.integrations.Core.UploadFile({ file });
    downloadUrl = res?.file_url || null;
  } catch (err) {
    console.error("seguridad-backup upload error", err?.message || err);
  }
  return Response.json({ ok: !!downloadUrl, checkpoint: "SEGURIDAD-1", generated_at: ts, counts: dump.counts, downloadUrl, fallback_data_url: downloadUrl ? null : ("data:application/json;base64," + btoa(unescape(encodeURIComponent(json)))) });
}