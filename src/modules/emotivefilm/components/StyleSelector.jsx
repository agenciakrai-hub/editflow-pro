// Selector de estilo. AUTO IA por defecto; el resto son opcionales.

const STYLES = [
  { id: "auto", label: "AUTO IA", icon: "✨", desc: "La IA decide todo" },
  { id: "elegant", label: "ELEGANT", icon: "🤍", desc: "Lento y refinado" },
  { id: "cinematic", label: "CINEMATIC", icon: "🎬", desc: "Cinematográfico" },
  { id: "emotional", label: "EMOTIONAL", icon: "❤️", desc: "Emocional" },
  { id: "luxury", label: "LUXURY", icon: "✨", desc: "Lujo" },
  { id: "dynamic", label: "DYNAMIC", icon: "🔥", desc: "Dinámico" },
  { id: "story", label: "STORY", icon: "🎞️", desc: "Narrativo" },
];

export default function StyleSelector({ style, onChange }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Estilo</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className={
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors " +
              (style === s.id
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-secondary")
            }
            title={s.desc}
          >
            <span>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}