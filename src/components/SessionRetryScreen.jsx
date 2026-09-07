import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

// Pantalla de reintento cuando la verificación de la sesión falla por un motivo
// TRANSITORIO (red caída, servidor no disponible, timeout). El token sigue guardado
// en el dispositivo y NO se ha cerrado la sesión: el usuario nunca debe volver al
// login por un fallo puntual — solo se reintenta la verificación.
export default function SessionRetryScreen() {
  const { checkAppState } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await checkAppState();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        <RefreshCw className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-4 font-heading text-xl">No se pudo verificar tu sesión</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tu sesión sigue activa en este dispositivo; parece que hubo un problema de conexión. No se ha cerrado la sesión.
        </p>
        <Button onClick={retry} className="mt-6 w-full" disabled={retrying}>
          {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {retrying ? "Comprobando…" : "Reintentar"}
        </Button>
      </div>
    </div>
  );
}