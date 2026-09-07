// Renderizador de LIENZOS a canvas (Fase Exportación). Lee el proyecto y los spreads
// tal cual (motor de layouts, transformaciones virtuales y encuadres intactos) y pinta
// cada lienzo a resolución configurable. No muta NADA: álbum, spreads y fotos solo se
// leen. Es el ÚNICO renderizador — el modal de exportación lo reutiliza para las dos
// modalidades (impresión y revisión manual).
import { getTierPreview, getPreview, previewKey } from "@/modules/album/lib/previewStore";

// Mejor preview disponible localmente para una foto (1000 px → 256 px → legado Fase 2).
export async function getBestPreviewUrl(projectId, photo) {
  let url = await getTierPreview(projectId, photo.id, "preview");
  if (!url) url = await getTierPreview(projectId, photo.id, "thumb");
  if (!url) url = await getPreview(previewKey(projectId, photo.filename));
  return url || null;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Carga bajo demanda las previews de las fotos de un lienzo (caché compartida por
// exportación). Las fotos originales NUNCA se tocan.
export async function preloadSpreadImages(projectId, spread, photosById, cache = new Map()) {
  await Promise.all(
    (spread.slots || []).map(async (sl) => {
      if (!sl.photo_id || cache.has(sl.photo_id)) return;
      const photo = photosById.get(sl.photo_id);
      if (!photo) return;
      const url = await getBestPreviewUrl(projectId, photo);
      cache.set(sl.photo_id, url ? await loadImage(url) : null);
    })
  );
  return cache;
}

// Pinta una foto en su hueco replicando EXACTAMENTE el render del editor: object-fit
// contain ("fit", foto completa) o cover ("fill") + transformación virtual (zoom y
// desplazamiento alrededor del centro del hueco, como en pantalla).
function drawPhoto(ctx, img, box, ppm, transform, fitMode) {
  const t = transform || {};
  const scale = t.scale ?? 1;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = (fitMode || "fit") === "fill" ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih);
  const dw = iw * s;
  const dh = ih * s;
  const dx = box.x + (box.w - dw) / 2;
  const dy = box.y + (box.h - dh) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const ox = (t.offset_x_mm || 0) * ppm;
  const oy = (t.offset_y_mm || 0) * ppm;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.drawImage(img, cx + (dx - cx) * scale + ox, cy + (dy - cy) * scale + oy, dw * scale, dh * scale);
  ctx.restore();
}

function drawPlaceholder(ctx, box, label, ppm, empty) {
  ctx.save();
  ctx.fillStyle = empty ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.08)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = "#737373";
  ctx.font = `500 ${Math.max(9, ppm * 2)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const short = label && label.length > 30 ? label.slice(0, 27) + "…" : label || "Sin foto";
  ctx.fillText(empty ? "Hueco vacío" : short, box.x + box.w / 2, box.y + box.h / 2);
  ctx.restore();
}

function drawReviewOverlays(ctx, canvas, ppm, slots, boxes, album, overlays, photosById, b, W, H) {
  // Elementos de revisión, SOLO en la exportación de revisión manual.
  if (overlays.cutMarks) {
    // Área de corte: límite exacto del recorte del lienzo (borde del sangrado incluido).
    ctx.save();
    ctx.strokeStyle = "#EF4444";
    ctx.lineWidth = Math.max(1, ppm * 0.3);
    ctx.setLineDash([ppm * 3, ppm * 3]);
    ctx.strokeRect(b, b, W, H);
    ctx.restore();
  }
  if (overlays.spineLine) {
    // Línea de lomo: centro horizontal del lienzo (gutter).
    ctx.save();
    ctx.strokeStyle = "#3B82F6";
    ctx.lineWidth = Math.max(1, ppm * 0.3);
    ctx.setLineDash([ppm * 4, ppm * 4]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.restore();
  }
  slots.forEach((sl, i) => {
    const box = boxes[i];
    if (overlays.imageNumbers && sl.photo_id) {
      const r = Math.max(8, ppm * 2.2);
      ctx.save();
      ctx.fillStyle = "rgba(26,26,26,0.85)";
      ctx.beginPath();
      ctx.arc(box.x + r, box.y + r, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `700 ${Math.max(9, ppm * 2.4)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), box.x + r, box.y + r + 1);
      ctx.restore();
    }
    if (overlays.filenames && sl.photo_id) {
      const photo = photosById.get(sl.photo_id);
      const fs = Math.max(9, ppm * 1.9);
      const text = photo?.filename || sl.photo_id;
      ctx.save();
      ctx.font = `500 ${fs}px sans-serif`;
      const tw = ctx.measureText(text).width;
      const pad = fs * 0.4;
      ctx.fillStyle = "rgba(26,26,26,0.72)";
      ctx.fillRect(box.x, box.y + box.h - fs - pad * 2, tw + pad * 2, fs + pad * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, box.x + pad, box.y + box.h - fs / 2 - pad);
      ctx.restore();
    }
  });
  if (overlays.lienzoNumber && overlays.lienzoTotal) {
    const fs = Math.max(14, ppm * 4);
    const label = `Lienzo ${overlays.lienzoNumber} de ${overlays.lienzoTotal}`;
    ctx.save();
    ctx.font = `700 ${fs}px sans-serif`;
    const tw = ctx.measureText(label).width;
    const pad = fs * 0.5;
    ctx.fillStyle = "rgba(26,26,26,0.85)";
    ctx.fillRect(b + ppm * 3, b + ppm * 3, tw + pad * 2, fs + pad * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, b + ppm * 3 + pad, b + ppm * 3 + fs / 2 + pad);
    ctx.restore();
  }
  if (overlays.watermark) {
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#1A1A1A";
    const fs = Math.max(16, ppm * 5);
    ctx.font = `800 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 9);
    for (let r = -3; r <= 3; r++) {
      for (let c = -3; c <= 3; c++) ctx.fillText(overlays.watermark, c * fs * 6, r * fs * 3.2);
    }
    ctx.restore();
  }
}

// Renderiza UN lienzo a canvas. opts: { pxPerMm, includeBleed, overlays, photosById }.
// Devuelve { canvas, missingCount } — missingCount = fotos asignadas sin preview
// disponible en este dispositivo (avisables al terminar la exportación).
export function renderSpreadToCanvas(album, spread, images, opts = {}) {
  const ppm = opts.pxPerMm;
  const bleedMm = opts.includeBleed ? album.bleed_mm ?? 3 : 0;
  const W = album.width_mm * ppm;
  const H = album.height_mm * ppm;
  const b = bleedMm * ppm;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W + 2 * b);
  canvas.height = Math.round(H + 2 * b);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = spread.background_color || album.background_color || "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const slots = [...(spread.slots || [])].sort((a, c) => (a.z_index || 0) - (c.z_index || 0));
  const boxes = slots.map((sl) => ({ x: sl.x_mm * ppm + b, y: sl.y_mm * ppm + b, w: sl.w_mm * ppm, h: sl.h_mm * ppm }));
  let missingCount = 0;

  slots.forEach((sl, i) => {
    const box = boxes[i];
    const img = sl.photo_id ? images.get(sl.photo_id) : null;
    if (img) {
      drawPhoto(ctx, img, box, ppm, sl.transform, sl.fit_mode);
      return;
    }
    if (sl.photo_id) {
      missingCount += 1;
      if (opts.overlays) {
        const photo = opts.photosById?.get?.(sl.photo_id);
        drawPlaceholder(ctx, box, photo?.filename || sl.photo_id, ppm, false);
      }
    } else if (opts.overlays) {
      drawPlaceholder(ctx, box, "", ppm, true);
    }
  });

  if (opts.overlays) {
    drawReviewOverlays(ctx, canvas, ppm, slots, boxes, album, opts.overlays, opts.photosById, b, W, H);
  }
  return { canvas, missingCount };
}