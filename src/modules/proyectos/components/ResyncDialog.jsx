import { Loader2, FolderOpen } from "lucide-react";

export default function ResyncDialog({ message, buttonLabel, onResync, loading }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm text-foreground">{message}</p>
      <button
        onClick={onResync}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
        {buttonLabel}
      </button>
    </div>
  );
}