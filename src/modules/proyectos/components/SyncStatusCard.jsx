const STATUS_MAP = {
  synced: { emoji: "🟢", label: "Sincronizado" },
  partial: { emoji: "🟡", label: "Parcial" },
  missing: { emoji: "🔴", label: "No encontrado" },
};

export default function SyncStatusCard({ title, status, message }) {
  const s = STATUS_MAP[status] || STATUS_MAP.missing;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{s.emoji}</span>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{s.label}</p>
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}