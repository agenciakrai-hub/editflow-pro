// EditFlow Pro engine — grouped backend function (Editkrfoto structure, ported
// Python/FastAPI -> TS). Routes four actions; never recalculates adjustments —
// reads the values computed and saved by the wedding-raw-ai editor module.
// ZIPs are returned as base64 data URLs (storage upload isn't available for
// in-memory blobs from the backend).
import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import JSZip from "npm:jszip@3.10.1";
import { generateXMP, LEEME_TXT } from "../../shared/xmp.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const action = body.action;

    if (action === "export") return await doExport(base44, body);
    if (action === "process") return await doProcess(base44, body);
    if (action === "plugin") return await doPlugin(base44);
    if (action === "sync") return await doSync(base44, body);

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

// action=plugin — package the Lightroom plugin (Lua files + INSTALAR.txt) into a
// ZIP on the fly (Editkrfoto /api/lr/plugin-download style) and return the URL.
async function doPlugin(base44) {
  const zip = new JSZip();
  const folder = zip.folder("EditFlowPro.lrplugin");
  folder.file("info.lua", INFO_LUA);
  folder.file("EditFlowExportProvider.lua", EXPORT_PROVIDER_LUA);
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

const INFO_LUA = `return {
  VERSION = { major=1, minor=0, revision=0, build=1 },
  LrSdkVersion = 13.0,
  LrSdkMinimumVersion = 6.0,
  LrPluginName = "EditFlow Pro Sync",
  LrExportServiceProvider = "EditFlowExportProvider",
  LrExportDialog = "EditFlowExportDialog",
}
`;

const EXPORT_PROVIDER_LUA = `-- EditFlow Pro export provider: sends XMP sidecars back to the app.
local LrHttp = import "LrHttp"
local LrPathUtils = import "LrPathUtils"
local LrExportSession = import "LrExportSession"

local EditFlowExportProvider = {}

function EditFlowExportProvider.processRenderedPhotos(functionContext, exportParams)
  local exportSession = LrExportSession:processRenderedPhotos(functionContext, exportParams)
  local token = exportParams.editflowToken or ""
  local endpoint = exportParams.editflowEndpoint or "https://app/api/functions/editflow-engine"
  for _, rendition in exportSession:renditions() do
    local photo = rendition.photo
    LrHttp.post(endpoint, "token=" .. token .. "&file=" .. photo:getFormattedMetadata("fileName"), {})
  end
end

return EditFlowExportProvider
`;

const INSTALAR_TXT = `EditFlow Pro - Plugin de Lightroom Classic
=========================================

1. Descomprime este ZIP. Obtendras una carpeta EditFlowPro.lrplugin.
2. En Lightroom Classic: Archivo > Complementos adicionales > Administrar.
3. Pulsa "Anadir" y selecciona la carpeta EditFlowPro.lrplugin.
4. Activa el plugin y reinicia Lightroom si lo pide.
5. En Exportar, selecciona "EditFlow Pro Sync" como destino.
6. Pega tu Token de conexion (generado en la app) en el dialogo de exportacion.

El plugin enviara los sidecars XMP a EditFlow Pro para llevar el control
de fotos pendientes y sincronizadas.
`;