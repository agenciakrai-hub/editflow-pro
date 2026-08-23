import { COLOR_LABELS, STAR_VALUES } from "@/lib/rawaistudio/labels";

const QUICK_FILTERS = [["selected", "Seleccionadas"], ["all", "Todas"], ["unselected", "No seleccionadas"]];

export default function ReviewFilters({ quickFilter, onQuickFilter, colorFilter, onToggleColor, minStars, onMinStars }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-md bg-zinc-900 p-1">
        {QUICK_FILTERS.map(([key, label]) => (
          <button key={key} onClick={() => onQuickFilter(key)}
            className={`rounded px-2 py-1 text-xs ${quickFilter === key ? "bg-white text-black" : "text-zinc-400"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {COLOR_LABELS.map((c) => (
          <button key={c.key} onClick={() => onToggleColor(c.key)} title={c.label}
            className={`h-5 w-5 rounded-full border-2 ${colorFilter.has(c.key) ? "border-white" : "border-transparent opacity-40"}`}
            style={{ backgroundColor: c.color }} />
        ))}
      </div>
      <select value={minStars} onChange={(e) => onMinStars(Number(e.target.value))}
        className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
        <option value={0}>Todas las estrellas</option>
        {STAR_VALUES.map((n) => (<option key={n} value={n}>{n}+ estrellas</option>))}
      </select>
    </div>
  );
}