// Vista de detalle de un PhotographerStyleProfile: muestra color_profile, edit_profile,
// creative_recipe (solo creativos), confianza y origen. Confirma visualmente que el
// perfil NO contiene básicos técnicos.
import { CheckCircle2 } from "lucide-react";
import { isCreativeOnly } from "@/lib/style/styleProfileToXmpTemplate";

const COLOR_FIELDS = [
  { key: "tendencia_color", label: "Tendencia de color" },
  { key: "saturacion", label: "Saturación" },
  { key: "representacion_piel", label: "Representación de piel" },
  { key: "caracter_tonal", label: "Carácter tonal" },
  { key: "contraste_creativo", label: "Contraste creativo" },
];

const EDIT_FIELDS = [
  { key: "tratamiento_luces", label: "Tratamiento de luces" },
  { key: "tratamiento_sombras", label: "Tratamiento de sombras" },
  { key: "negros", label: "Negros" },
  { key: "suavidad_crispness", label: "Suavidad / crispness" },
  { key: "caracter_acabado", label: "Carácter de acabado" },
  { key: "consistencia", label: "Consistencia" },
];

const RECIPE_KEYS = ["Vibrance", "Saturation", "Clarity2012", "Texture2012", "Dehaze2012", "Sharpness"];

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}

export default function StyleProfileView({ profile }) {
  const cp = profile.color_profile || {};
  const ep = profile.edit_profile || {};
  const recipe = profile.creative_recipe || {};
  const creativeOnly = isCreativeOnly(recipe);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{profile.name}</h2>
        <span className="text-xs text-muted-foreground">
          {profile.source?.provider || "—"} · {profile.source?.image_count ?? 0} imgs
        </span>
      </div>

      <div className={`flex items-center gap-2 rounded-lg p-2 text-xs ${creativeOnly ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
        <CheckCircle2 className="h-4 w-4" />
        {creativeOnly
          ? "Receta creativa válida: sin básicos técnicos (Exposure/Contrast/HL/Sh/Wh/Bl/Temp/Tint)."
          : "Atención: la receta contiene básicos técnicos y será saneada al aplicarse."}
      </div>

      <div>
        <p className="text-xs font-semibold mb-2 text-muted-foreground">Color</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COLOR_FIELDS.map((f) => <Field key={f.key} label={f.label} value={cp[f.key]} />)}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold mb-2 text-muted-foreground">Edición / Look</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EDIT_FIELDS.map((f) => <Field key={f.key} label={f.label} value={ep[f.key]} />)}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold mb-2 text-muted-foreground">Receta creativa (sliders Lightroom)</p>
        <div className="flex flex-wrap gap-2">
          {RECIPE_KEYS.map((k) => (
            <span key={k} className="rounded-md bg-secondary px-2 py-1 text-xs font-mono">
              {k}: <span className="text-accent">{recipe[k] ?? 0}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Confianza del análisis: {profile.confidence ?? 0}%
        </p>
      </div>
    </div>
  );
}