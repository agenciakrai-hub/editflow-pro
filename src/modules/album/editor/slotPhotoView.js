// ÚNICA FUENTE DE VERDAD — cómo se interpreta fit_mode + transform de un hueco al
// dibujar su foto. La usan TODOS los renderizadores del DOM (lienzo del editor y
// miniatura del navegador de lienzos): mismo FIT/CONTAIN (foto completa, centrada,
// proporción original), mismo COVER ("fill": rellena y recorta sin deformar) y la
// misma transformación virtual (escala + offsets). Cada renderizador solo cambia la
// resolución a la que dibuja: en el lienzo los offsets se escalan con ppm (mm→px) y
// en la miniatura se expresan como porcentaje del hueco — la GEOMETRÍA en mm es
// idéntica en ambos. La exportación (spreadRenderer) implementa la misma matemática
// en canvas 2D. Ningún componente puede volver a interpretar el ajuste por su cuenta.
export function slotPhotoView(slot) {
  const t = (slot && slot.transform) || {};
  return {
    objectFit: slot?.fit_mode === "fill" ? "cover" : "contain",
    scale: t.scale ?? 1,
    // Offsets normalizados al tamaño del hueco (porcentaje): equivalen exactamente a
    // offset_mm * ppm en el lienzo, porque el <img> ocupa el 100 % del hueco.
    offsetXPct: slot?.w_mm > 0 ? ((t.offset_x_mm || 0) / slot.w_mm) * 100 : 0,
    offsetYPct: slot?.h_mm > 0 ? ((t.offset_y_mm || 0) / slot.h_mm) * 100 : 0,
  };
}