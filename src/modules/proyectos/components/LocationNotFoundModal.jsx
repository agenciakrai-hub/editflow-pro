import { FolderOpen, Loader2, AlertTriangle } from "lucide-react";

// Modal centrado — aparece SOLO cuando la carpeta RAW y/o el catálogo Lightroom asociados
// al proyecto ya no son accesibles. No se muestra si todo sigue sincronizado (🟢).
export default function LocationNotFoundModal({ missingFolder, missingCatalog, onRelocateFolder, onRelocateCatalog, loading }) {
  if (!missingFolder && !missingCatalog) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 space-y-4 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-yellow-500" />
        <h2 className="text-base font-semibold">Ubicación del proyecto no encontrada</h2>
        {missingFolder && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              La carpeta de fotografías asociada a este proyecto ya no está disponible.
            </p>
            <button
              onClick={onRelocateFolder}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
              Reubicar carpeta de fotografías
            </button>
          </div>
        )}
        {missingCatalog && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              El catálogo de Lightroom asociado a este proyecto ya no está disponible.
            </p>
            <button
              onClick={onRelocateCatalog}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
              Reubicar catálogo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}