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

    // User-auth actions.
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (action === "export") return await doExport(base44, body);
    if (action === "process") return await doProcess(base44, body);
    if (action === "sync") return await doSync(base44, body);
    if (action === "plugin") return await doPlugin();
    if (action === "lr-token") return await doLrToken(base44, user);
    if (action === "lr-push") return await doLrPush(base44, user, body);
    if (action === "lr-stats") return await doLrStats(base44, user);

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

  const ids = Array.isArray(body.ids) ? body.ids : [];
  for (const id of ids) {
    try { await base44.asServiceRole.entities.LrJob.update(String(id), { status: "completed" }); }
    catch (e) { console.error("lr-complete update", id, e?.message || e); }
  }
  return Response.json({ completed: ids.length });
}

// ---- Lua plugin sources (backslash-free; safe inside TS template literals) ----

const INFO_LUA = `return {
    LrSdkVersion = 12.0,
    LrSdkMinimumVersion = 6.0,
    LrToolkitIdentifier = "com.editflowpro.sync",
    LrPluginName = "EditFlow Pro",
    VERSION = { major = 1, minor = 0, revision = 0 },
    LrExportMenuItems = {
        { title = "EditFlow Pro: Sincronizar seleccionadas", file = "Sync.lua" },
        { title = "EditFlow Pro: Configurar (token)", file = "Settings.lua" },
    },
    LrLibraryMenuItems = {
        { title = "EditFlow Pro: Sincronizar seleccionadas", file = "Sync.lua" },
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
`;