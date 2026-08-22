import { useNavigate } from "react-router-dom";
import { Check, ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

export default function ThankYou() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const me = await base44.auth.me();
        if (me?.subscription_status === "active") {
          setChecking(false);
          return;
        }
      } catch {}
      setTimeout(() => setChecking(false), 4000);
    };
    check();
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-5">
          {checking ? <Loader2 className="w-8 h-8 text-white animate-spin" /> : <Check className="w-8 h-8 text-white" />}
        </div>
        <h1 className="text-2xl font-bold mb-2">{checking ? "Confirmando tu pago..." : "¡Pago completado!"}</h1>
        <p className="text-muted-foreground mb-6">
          {checking ? "Estamos activando tu suscripción." : "Tu suscripción está activa. Ya puedes acceder a todas las herramientas."}
        </p>
        <button onClick={() => navigate("/dashboard")} disabled={checking} className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
          Ir al dashboard <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}