import React, { useRef } from "react";

// Tirador de redimensionado vertical: arrastra para ajustar la altura del panel que
// lo rodea (barra superior arriba, navegador de fotos abajo). El primer arrastre
// parte de la altura REAL del panel (medida del propio elemento); doble clic
// restaura la altura natural.
export default function ResizeHandle({ targetRef, onChange, min = 40, max = 400, label }) {
  const start = useRef(null);
  const onDown = (e) => {
    e.preventDefault();
    start.current = { y: e.clientY, h: targetRef?.current?.offsetHeight || min };
    const move = (ev) => {
      if (!start.current) return;
      onChange(Math.min(max, Math.max(min, start.current.h + (ev.clientY - start.current.y))));
    };
    const up = () => {
      start.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div onMouseDown={onDown} onDoubleClick={() => onChange(null)}
      title={label ? `${label} · doble clic restaura la altura` : "Arrastra para redimensionar · doble clic restaura"}
      className="group z-20 flex h-2 shrink-0 cursor-row-resize items-center justify-center">
      <span className="h-0.5 w-12 rounded-full bg-border transition-colors group-hover:bg-primary" />
    </div>
  );
}