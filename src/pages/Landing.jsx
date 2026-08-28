import { useNavigate } from "react-router-dom";
import { Image as ImageIcon, Palette, Download, Sparkles, Check, ArrowRight } from "lucide-react";
import { Image } from "@/components/ui/image";
import { base44 } from "@/api/base44Client";

const tools = [
  { icon: ImageIcon, title: "Selección IA", desc: "Culling inteligente que descarta fotos con ojos cerrados, desenfoque o duplicados en segundos." },
  { icon: Palette, title: "Editor con Presets", desc: "Aplica tu estilo con presets personalizados. Ajustes básicos tipo Lightroom con un clic." },
  { icon: Download, title: "Exportación XMP", desc: "Genera archivos XMP compatibles con Lightroom y sincroniza vía Plugin sin fricción." },
];

const steps = [
  { n: "01", title: "Carga tus fotos", desc: "Sube la sesión completa en RAW. Sin límite de archivos." },
  { n: "02", title: "Selecciona y edita", desc: "La IA descarta y tú aplicas presets. Ajustes finos tipo Lightroom." },
  { n: "03", title: "Exporta a Lightroom", desc: "Descarga archivos XMP o sincroniza con el Plugin de Lightroom." },
];

const plans = [
  { id: "starter", name: "Starter", price: "19", features: ["Hasta 1.000 fotos/mes", "Selección IA básica", "10 presets incluidos", "Exportación XMP"] },
  { id: "pro", name: "Pro", price: "49", features: ["Fotos ilimitadas", "Selección IA avanzada", "Presets ilimitados", "Sincronización Plugin Lightroom", "Soporte prioritario"], popular: true },
  { id: "studio", name: "Studio", price: "99", features: ["Todo en Pro", "Múltiples usuarios", "Marcas blancas", "API de integración", "Gestor de cuenta dedicado"] },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-1.5">
            <svg width="14" height="26" viewBox="0 0 14 26" className="text-primary"><path d="M14 0 A13 13 0 0 0 14 26 Z" fill="currentColor" /></svg>
            <span className="text-lg font-bold tracking-tight">EditKR</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/login")} className="px-4 py-2 text-sm font-medium hover:bg-secondary rounded-lg transition-colors">Iniciar sesión</button>
            <button onClick={() => navigate("/register")} className="px-4 py-2 text-sm font-semibold bg-accent text-white rounded-lg hover:opacity-90 transition-opacity">Crear cuenta</button>
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-full text-xs font-medium text-muted-foreground mb-6">
          <Sparkles className="w-3.5 h-3.5 text-accent" /> Post-producción con IA para fotógrafos
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-balance mb-4">
          Edita bodas completas en <span className="text-accent">minutos</span>, no en horas
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8 text-balance">
          Selección inteligente, edición con presets y exportación XMP para Lightroom. Todo tu flujo de post-producción en una sola app.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate("/register")} className="px-6 py-3 bg-accent text-white rounded-xl font-semibold hover:opacity-90 transition-opacity flex items-center gap-2">
            Empezar gratis <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={() => navigate("/login")} className="px-6 py-3 bg-card border border-border rounded-xl font-semibold hover:bg-secondary transition-colors">
            Ver demo
          </button>
        </div>
        <div className="mt-12 rounded-2xl overflow-hidden border border-border shadow-lg">
          <Image src="https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=1000&q=80" className="w-full aspect-[16/9]" fittingType="fill" />
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-center mb-10">Tres herramientas, un flujo completo</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {tools.map((t, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-6">
              <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
                <t.icon className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-semibold mb-1.5">{t.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-center mb-10">Cómo funciona</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {steps.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-3xl font-bold text-accent mb-2">{s.n}</div>
              <h3 className="font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="max-w-5xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold text-center mb-2">Planes simples</h2>
        <p className="text-center text-muted-foreground mb-10">Cancela cuando quieras. Sin permanencia.</p>
        <div className="grid sm:grid-cols-3 gap-4">
          {plans.map(p => (
            <div key={p.id} className={`bg-card rounded-2xl border p-6 flex flex-col ${p.popular ? "border-accent ring-1 ring-accent" : "border-border"}`}>
              {p.popular && <div className="text-xs font-semibold text-accent mb-2">MÁS POPULAR</div>}
              <h3 className="font-bold text-lg mb-1">{p.name}</h3>
              <div className="mb-4"><span className="text-3xl font-bold">{p.price}€</span><span className="text-muted-foreground">/mes</span></div>
              <ul className="space-y-2 mb-6 flex-1">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" /> {f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate("/register")} className="w-full py-2.5 rounded-xl font-semibold text-sm transition-colors bg-accent text-white hover:opacity-90">
                Elegir {p.name}
              </button>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border mt-12">
        <div className="max-w-5xl mx-auto px-4 py-8 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="22" viewBox="0 0 14 26" className="text-primary"><path d="M14 0 A13 13 0 0 0 14 26 Z" fill="currentColor" /></svg>
            <span className="font-bold">EditKR</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 EditKR Foto. Post-producción con IA.</p>
        </div>
      </footer>
    </div>
  );
}