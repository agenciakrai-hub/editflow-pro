import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Sparkles, Crown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

const PLANS = [
  { id: "starter", name: "Starter", price: "19", features: ["Hasta 1.000 fotos/mes", "Selección IA básica", "10 presets incluidos", "Exportación XMP"] },
  { id: "pro", name: "Pro", price: "49", features: ["Fotos ilimitadas", "Selección IA avanzada", "Presets ilimitados", "Sincronización Plugin Lightroom", "Soporte prioritario"], popular: true },
  { id: "studio", name: "Studio", price: "99", features: ["Todo en Pro", "Múltiples usuarios", "Marcas blancas", "API de integración", "Gestor de cuenta"] },
];

export default function Subscription() {
  const [user, setUser] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleCheckout = async (planId) => {
    setLoadingPlan(planId);
    try {
      const res = await base44.functions.invoke("create-checkout", { productId: planId });
      if (res?.data?.redirectUrl) {
        window.location.href = res.data.redirectUrl;
      } else {
        toast({ title: "Error", description: "No se pudo iniciar el pago", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "No se pudo iniciar el pago", variant: "destructive" });
    } finally {
      setLoadingPlan(null);
    }
  };

  const currentPlan = user?.plan ?? "none";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/dashboard")} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold flex-1">Suscripción</h1>
      </div>

      {currentPlan !== "none" && user?.subscription_status === "active" && (
        <div className="bg-accent/10 border border-accent/30 rounded-2xl p-4 flex items-center gap-3">
          <Crown className="w-5 h-5 text-accent" />
          <div>
            <p className="text-sm font-semibold">Plan {currentPlan.toUpperCase()} activo</p>
            <p className="text-xs text-muted-foreground">Tu suscripción está activa</p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {PLANS.map(p => {
          const isCurrent = currentPlan === p.id;
          return (
            <div key={p.id} className={`bg-card rounded-2xl border p-5 ${p.popular ? "border-accent ring-1 ring-accent" : "border-border"}`}>
              {p.popular && <div className="inline-flex items-center gap-1 text-xs font-semibold text-accent mb-2"><Sparkles className="w-3.5 h-3.5" /> MÁS POPULAR</div>}
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-bold text-lg">{p.name}</h3>
                <div><span className="text-2xl font-bold">{p.price}€</span><span className="text-muted-foreground text-sm">/mes</span></div>
              </div>
              <ul className="space-y-1.5 mb-4">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 text-accent shrink-0 mt-0.5" /> {f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="w-full py-2.5 rounded-xl font-semibold text-sm bg-secondary text-muted-foreground text-center">Plan actual</div>
              ) : (
                <button onClick={() => handleCheckout(p.id)} disabled={loadingPlan !== null} className="w-full py-2.5 rounded-xl font-semibold text-sm transition-opacity bg-accent text-white hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                  {loadingPlan === p.id ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirigiendo...</> : `Elegir ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground text-center">Pagos seguros vía Base44 Payments · Cancela cuando quieras</p>
    </div>
  );
}