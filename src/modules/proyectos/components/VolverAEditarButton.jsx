import { Sparkles } from "lucide-react";

export default function VolverAEditarButton({ onClick, disabled, count }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-40"
    >
      <Sparkles className="h-4 w-4" />
      Volver a editar selección{typeof count === "number" ? ` (${count})` : ""}
    </button>
  );
}