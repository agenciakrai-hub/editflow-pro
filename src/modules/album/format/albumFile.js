// Formato .editflowalbum v1 (Fase 1 §6): serialización, descarga, validación e
// importación. Las secciones ai/export_targets quedan RESERVADAS (null).
import { createAlbum, addPhotos, createSpread } from "@/modules/album/hooks/useAlbumProject";

export const ALBUM_FORMAT_VERSION = 1;
const freshT = () => ({ scale: 1, offset_x_mm: 0, offset_y_mm: 0, rotation: 0, crop: null });

export function buildAlbumDocument(project, photos, spreads) {
  return {
    format_version: ALBUM_FORMAT_VERSION,
    kind: "editflow-album",
    project: {
      id: project.id,
      name: project.name,
      event_type: project.event_type || "other",
      created_date: project.created_date || null,
      status: project.status || "draft",
    },
    album: {
      width_mm: project.width_mm,
      height_mm: project.height_mm,
      dpi: project.dpi ?? 300,
      bleed_mm: project.bleed_mm ?? 3,
      margin_mm: project.margin_mm ?? 10,
      gutter_mm: project.gutter_mm ?? 6,
      size_preset: project.size_preset || "custom",
      display_unit: project.display_unit || "cm",
      spread_count_target: project.spread_count_target ?? 20,
      max_photos_per_spread: project.max_photos_per_spread ?? 6,
      style_hint: project.style_hint || "minimal",
    },
    photos: (photos || []).map((p) => ({
      photo_id: p.id,
      filename: p.filename,
      relative_path: p.relative_path || p.filename,
      orientation: p.orientation || "landscape",
      capture_time: p.capture_time ?? null,
      ai_state: p.ai_state || "unreviewed",
      ai_rank: p.ai_rank ?? null,
      ai_scores: p.ai_scores ?? null,
      ai_category: p.ai_category ?? null,
    })),
    spreads: (spreads || []).map((s) => ({
      spread_id: s.id,
      order_index: s.order_index ?? 0,
      mode: s.mode || "spread",
      layout_id: s.layout_id || "custom",
      locked: !!s.locked,
      ai_generated: !!s.ai_generated,
      slots: (s.slots || []).map((sl) => ({
        slot_id: sl.slot_id,
        photo_id: sl.photo_id || null,
        x_mm: sl.x_mm, y_mm: sl.y_mm, w_mm: sl.w_mm, h_mm: sl.h_mm,
        fit_mode: sl.fit_mode || "fill",
        z_index: sl.z_index ?? 0,
        transform: sl.transform || freshT(),
      })),
    })),
    ai: { selection: null, story: null, layout_decisions: null },
    export_targets: null,
  };
}

export function downloadAlbumFile(project, photos, spreads) {
  const doc = buildAlbumDocument(project, photos, spreads);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (project.name || "album").replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, "").trim() + ".editflowalbum";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function parseAlbumDocument(text) {
  const doc = JSON.parse(text);
  if (doc?.kind !== "editflow-album" || typeof doc.format_version !== "number") {
    throw new Error("No es un archivo .editflowalbum válido");
  }
  if (doc.format_version > ALBUM_FORMAT_VERSION) {
    throw new Error(`Versión ${doc.format_version} no soportada (máxima: ${ALBUM_FORMAT_VERSION})`);
  }
  if (!doc.album?.width_mm || !doc.album?.height_mm) throw new Error("El archivo no define dimensiones del álbum");
  return doc;
}

// Importa un documento como álbum NUEVO (copia). Remapea photo_id antiguos → nuevos.
// Las previews no viajan en el archivo: las fotos quedan "missing" hasta re-importar
// la carpeta (re-emparejamiento por nombre de archivo).
export async function importAlbumDocument(doc) {
  const a = doc.album;
  const proj = await createAlbum({
    name: (doc.project?.name || "Álbum importado"),
    event_type: doc.project?.event_type || "other",
    status: "designing",
    width_mm: a.width_mm,
    height_mm: a.height_mm,
    dpi: a.dpi ?? 300,
    bleed_mm: a.bleed_mm ?? 3,
    margin_mm: a.margin_mm ?? 10,
    gutter_mm: a.gutter_mm ?? 6,
    size_preset: a.size_preset || "custom",
    display_unit: a.display_unit || "cm",
    spread_count_target: a.spread_count_target ?? 20,
    max_photos_per_spread: a.max_photos_per_spread ?? 6,
    style_hint: a.style_hint || "minimal",
    source_folder_name: "importado",
    doc_version: "v1",
  });
  const idMap = new Map();
  const photoMetas = (doc.photos || []).map((p) => ({
    project_id: proj.id,
    filename: p.filename,
    relative_path: p.relative_path || p.filename,
    orientation: p.orientation || "landscape",
    capture_time: p.capture_time ?? null,
    preview_status: "missing",
    ai_state: "unreviewed",
  }));
  if (photoMetas.length) {
    const created = await addPhotos(photoMetas);
    (doc.photos || []).forEach((p, i) => { if (created[i]) idMap.set(p.photo_id, created[i].id); });
  }
  const spreadDocs = (doc.spreads || []).map((s, i) => ({
    project_id: proj.id,
    order_index: s.order_index ?? i,
    mode: s.mode || "spread",
    layout_id: s.layout_id || "custom",
    locked: !!s.locked,
    ai_generated: !!s.ai_generated,
    slots: (s.slots || []).map((sl) => ({
      slot_id: sl.slot_id,
      photo_id: idMap.get(sl.photo_id) || null,
      x_mm: sl.x_mm, y_mm: sl.y_mm, w_mm: sl.w_mm, h_mm: sl.h_mm,
      fit_mode: sl.fit_mode || "fill",
      z_index: sl.z_index ?? 0,
      transform: sl.transform || freshT(),
    })),
  }));
  for (const sd of spreadDocs) await createSpread(sd);
  return proj;
}