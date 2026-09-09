import { PARAM_DEFS } from "@/lib/rawaistudio/paramDefs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

// "Preferencia" es un desplazamiento sobre la corrección normal de la IA, no un límite:
// resultadoFinal = correcciónNormalIA + preferencia. 0 = dejar el criterio de la IA intacto.
export default function ParameterPanel({ config, onChange }) {
  const update = (key, patch) => onChange({ ...config, [key]: { ...config[key], ...patch } });

  return (
    <div className="mt-4 space-y-2">
      {PARAM_DEFS.map((p) => {
        const c = config[p.key] || {};
        return (
          <div key={p.key} className="flex items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2">
            <Switch checked={!!c.enabled} onCheckedChange={(v) => update(p.key, { enabled: v })} />
            <span className="w-28 text-sm text-foreground">{p.label}</span>
            <span className="text-xs text-muted-foreground">Preferencia</span>
            <Input type="number" disabled={!c.enabled} value={c.preference ?? 0} step={p.step} min={p.min} max={p.max}
              onChange={(e) => update(p.key, { preference: Number(e.target.value) })}
              className="h-8 w-24 bg-background text-xs text-foreground" />
          </div>
        );
      })}
    </div>
  );
}