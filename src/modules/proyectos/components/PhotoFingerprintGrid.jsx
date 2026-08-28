export const STATUS_LABEL = { TOP_PICK: "Top pick", SELECT: "Seleccionada", REVIEW: "A revisar", REJECT: "Descartada" };
export const STATUS_COLOR = {
  TOP_PICK: "border-accent text-accent",
  SELECT: "border-foreground text-foreground",
  REVIEW: "border-muted-foreground text-muted-foreground",
  REJECT: "border-destructive text-destructive",
};

export default function PhotoFingerprintGrid({ items, onCycleStatus }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-border bg-card overflow-hidden">
          {item.previewUrl ? (
            <img src={item.previewUrl} alt={item.filename} className="h-28 w-full object-cover" />
          ) : (
            <div className="h-28 w-full bg-muted" />
          )}
          <div className="p-2 space-y-1.5">
            <p className="truncate text-[11px] font-mono text-muted-foreground">{item.filename}</p>
            <button
              type="button"
              onClick={() => onCycleStatus(item.id)}
              className={`w-full rounded-md border px-2 py-1 text-[11px] font-medium ${STATUS_COLOR[item.status] || ""}`}
            >
              {STATUS_LABEL[item.status] || item.status}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}