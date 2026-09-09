// Punto 15 — VALIDACIÓN FINAL de la maquetación (determinista, sin IA): comprueba
// el álbum generado ANTES de darlo por terminado. Reutiliza las fuentes de verdad
// existentes: slotEffDpi (ppp efectivos del hueco), slotSizeClass (tamaño del
// hueco) y los grupos de ráfaga/secuencia de la Selección IA (similitud). La
// deformación y el acceso a la imagen original no se comprueban porque son
// imposibles por construcción (solo cover/contain con transform virtual).
import { slotEffDpi } from "@/modules/album/editor/slotPhotoView";
import { slotSizeClass } from "@/modules/album/layout/visualProfile";

export function validateLayout({ spreads, photosById, simGroups = null, roleOf = null, dpiWarn = 150 }) {
  const findings = [];
  const label = (s) => `Lienzo ${(s.order_index ?? 0) + 1}`;

  // FOTOS — duplicadas (punto 10): una foto solo puede usarse una vez.
  const seenIn = new Map();
  spreads.forEach((s) =>
    (s.slots || []).forEach((sl) => {
      if (!sl.photo_id) return;
      if (seenIn.has(sl.photo_id)) {
        findings.push({ severity: "error", kind: "duplicate", message: `Foto repetida: aparece en ${label(seenIn.get(sl.photo_id))} y en ${label(s)}.` });
      } else {
        seenIn.set(sl.photo_id, s);
      }
    })
  );

  // FOTOS — similares (puntos 2/8): mismo grupo de ráfaga/secuencia en un lienzo.
  if (simGroups?.size) {
    spreads.forEach((s) => {
      const perGroup = new Map();
      (s.slots || []).forEach((sl) => {
        if (!sl.photo_id) return;
        const g = simGroups.get(sl.photo_id);
        if (g == null) return;
        perGroup.set(g, (perGroup.get(g) || 0) + 1);
      });
      perGroup.forEach((count) => {
        if (count >= 2) findings.push({ severity: "warning", kind: "similar", message: `${label(s)}: ${count} fotos casi idénticas (misma ráfaga/secuencia) en el mismo lienzo.` });
      });
    });
  }

  // ENCUADRE + CALIDAD (puntos 4/6): ppp efectivos y zoom excesivo por hueco.
  spreads.forEach((s) => {
    const slots = s.slots || [];
    const maxArea = slots.reduce((m, g) => Math.max(m, (g.w_mm || 0) * (g.h_mm || 0)), 0);
    slots.forEach((sl) => {
      if (!sl.photo_id) return;
      const photo = photosById.get(sl.photo_id);
      if (!photo) return;
      const dpi = slotEffDpi(sl, photo);
      if (dpi != null && dpi < dpiWarn) {
        findings.push({ severity: "warning", kind: "quality", message: `${label(s)}: una foto imprimiría a ~${Math.round(dpi)} ppp en su hueco (impresión recomendada ≥ ${dpiWarn} ppp).` });
      }
      const scale = sl.transform?.scale ?? 1;
      if (scale > 3) {
        findings.push({ severity: "warning", kind: "quality", message: `${label(s)}: reencuadre con zoom del ${Math.round(scale * 100)}% (muy cerrado para impresión).` });
      }
      // DISTRIBUCIÓN (punto 7): las fotos HÉROE no deben quedar en huecos pequeños.
      if (roleOf?.get(sl.photo_id) === "hero" && slots.length > 1 && slotSizeClass(sl, maxArea) === "small") {
        findings.push({ severity: "warning", kind: "prominence", message: `${label(s)}: una foto HÉROE está colocada en un hueco pequeño.` });
      }
    });
    if (slots.length && !slots.some((sl) => sl.photo_id)) {
      findings.push({ severity: "warning", kind: "empty", message: `${label(s)} no tiene ninguna foto colocada.` });
    }
  });

  // LIENZOS — variedad de plantillas (punto 9): la misma plantilla 4+ veces seguidas.
  const sorted = [...spreads].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].layout_id && sorted[i].layout_id !== "custom" && sorted[i].layout_id === sorted[i - 1].layout_id) {
      run++;
      if (run === 4) findings.push({ severity: "info", kind: "variety", message: `Cuatro lienzos consecutivos usan la misma plantilla (${sorted[i].layout_id}).` });
    } else {
      run = 1;
    }
  }

  return findings;
}