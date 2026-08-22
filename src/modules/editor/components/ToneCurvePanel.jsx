import { useRef, useState } from "react";

const CHANNELS = [
  { id: "rgb", label: "RGB", stroke: "#e5e7eb" },
  { id: "red", label: "Rojo", stroke: "#ef4444" },
  { id: "green", label: "Verde", stroke: "#22c55e" },
  { id: "blue", label: "Azul", stroke: "#3b82f6" },
];

const SIZE = 220;

export default function ToneCurvePanel({ adjustments, setAdjustments }) {
  const curve = adjustments.curve || {};
  const [channel, setChannel] = useState("rgb");
  const svgRef = useRef(null);
  const dragIdx = useRef(null);

  const points = curve[channel] || [];

  const buildPath = (pts) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${255 - p[1]}`).join(" ");

  const onPointerDown = (idx) => (e) => {
    dragIdx.current = idx;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (dragIdx.current === null) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(255, ((e.clientX - rect.left) / rect.width) * 255));
    const y = Math.max(0, Math.min(255, 255 - ((e.clientY - rect.top) / rect.height) * 255));
    const pts = curve[channel] || [];
    const next = pts.map((p, i) => (i === dragIdx.current ? [Math.round(x), Math.round(y)] : p));
    setAdjustments((prev) => ({ ...prev, curve: { ...prev.curve, [channel]: next } }));
  };

  const onPointerUp = () => { dragIdx.current = null; };

  return (
    <div className="px-1 pb-2">
      <div className="flex gap-1.5 mb-3">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            onClick={() => setChannel(c.id)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${channel === c.id ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 255 255"
        width="100%"
        style={{ maxWidth: SIZE, aspectRatio: "1", background: "var(--secondary)" }}
        className="rounded-xl border border-border touch-none"
      >
        {[64, 128, 192].map((g) => (
          <g key={g}>
            <line x1={g} y1={0} x2={g} y2={255} stroke="rgba(0,0,0,0.1)" />
            <line x1={0} y1={g} x2={255} y2={g} stroke="rgba(0,0,0,0.1)" />
          </g>
        ))}
        <path d="M 0 255 L 255 0" stroke="rgba(0,0,0,0.15)" strokeDasharray="4 4" fill="none" />
        <path d={buildPath(points)} stroke={CHANNELS.find((c) => c.id === channel).stroke} strokeWidth={2} fill="none" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={255 - p[1]}
            r={5}
            fill="white"
            stroke="#111"
            strokeWidth={1.5}
            onPointerDown={onPointerDown(i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ cursor: "grab", touchAction: "none" }}
          />
        ))}
      </svg>
      <p className="text-xs text-muted-foreground mt-2">Arrastra los puntos para ajustar la curva de tonos.</p>
    </div>
  );
}