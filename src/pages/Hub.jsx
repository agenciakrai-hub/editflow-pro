import { Link } from "react-router-dom";
import { Images, Sparkles, FileImage, FolderHeart, Wand2, Brain } from "lucide-react";

// Hub de herramientas. Presenta las tres herramientas independientes como tarjetas.
// No ejecuta ninguna herramienta: cada tarjeta solo navega a su ruta.
const tools = [
  {
    to: "/proyectos",
    title: "Proyectos",
    desc: "Crea un proyecto nuevo o reabre uno guardado (solo metadatos). Recarga la carpeta/catálogo para volver a procesar.",
    icon: FolderHeart,
  },
  {
    to: "/dashboard",
    title: "Selección",
    desc: "Culling IA por ráfagas: TOP_PICK / SELECT / REVIEW / REJECT sobre una carpeta RAW.",
    icon: Images,
  },
  {
    to: "/ajustes-ia",
    title: "Ajustes IA",
    desc: "Revelado IA con plantilla mínima. Sin preset ni selección previa.",
    icon: Sparkles,
  },
  {
    to: "/preset-xmp",
    title: "Preset XMP",
    desc: "Aplica un preset .xmp de forma 100 % determinista. Sin IA, sin créditos.",
    icon: FileImage,
  },
  {
    to: "/estilos",
    title: "Creador de estilos",
    desc: "Aprende el look de un fotógrafo desde una galería pública y aplícalo como capa creativa en Ajustes IA.",
    icon: Wand2,
  },
  {
    to: "/cerebro",
    title: "Cerebro",
    desc: "Memoria del fotógrafo: presets registrados, estilos aprendidos e historial de correcciones.",
    icon: Brain,
  },
];

export default function Hub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Herramientas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada herramienta funciona de forma independiente. Combínalas opcionalmente con la sesión.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tools.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="group rounded-xl border border-border bg-card p-5 hover:border-accent transition-colors"
          >
            <t.icon className="h-6 w-6 text-accent" />
            <h2 className="mt-3 text-lg font-semibold">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
            <span className="mt-4 inline-flex items-center text-sm font-medium text-accent group-hover:underline">
              Abrir →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}