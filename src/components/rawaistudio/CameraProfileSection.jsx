import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { readCameraMetadata } from "@/lib/rawaistudio/cameraMetadata";
import { runPool } from "@/lib/rawaistudio/promisePool";
import { cameraKeyFromInfo } from "@/lib/rawaistudio/presetProfile";

const PROFILE_OPTIONS = [
  { value: "keep", label: "Mantener perfil original", hint: "No se toca ningún atributo de perfil del preset." },
  { value: "adobe_color", label: "Adobe Color", hint: "Perfil universal a color, válido para cualquier cámara." },
  { value: "adobe_neutral", label: "Adobe Neutral", hint: "Perfil universal neutro, sin viraje de color ni contraste extra." },
  { value: "adobe_monochrome", label: "Adobe Monochrome", hint: "Perfil universal en blanco y negro." },
  { value: "camera", label: "Perfil nativo de la cámara", hint: "No se fuerza ningún perfil: Lightroom usa el propio de cada RAW." }
];

const TREATMENTS = [
  { value: "auto", label: "Automático" },
  { value: "color", label: "Color" },
  { value: "monochrome", label: "Monocromo" }
];

const DEFAULT_CHOICE = { mode: "keep", treatment: "auto" };
const fileFormat = (name) => name.split(".").pop()?.toUpperCase() || "";

// Detecta las cámaras presentes en la cola y deja elegir perfil/tratamiento por cámara.
// onChange recibe { byCamera, default }. No sube nada: lee los metadatos del propio RAW.
export default function CameraProfileSection({ photos, value, onChange }) {
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(0);
  const [groups, setGroups] = useState([]);
  const [choices, setChoices] = useState({});

  useEffect(() => {
    let active = true;
    (async () => {
      const infos = await runPool(
        photos, 8,
        async (p) => ({ photo: p, info: await readCameraMetadata(p.file).catch(() => null) }),
        () => { if (active) setDone((d) => d + 1); }
      );
      if (!active) return;
      // Adjunta la info de cámara a cada foto para el paso de procesamiento.
      infos.forEach(({ photo, info }) => { photo.cameraInfo = info; });

      const byKey = new Map();
      infos.forEach(({ photo, info }) => {
        const key = cameraKeyFromInfo(info);
        const format = fileFormat(photo.file.name);
        if (!byKey.has(key)) byKey.set(key, { key, count: 0, formats: new Map() });
        const g = byKey.get(key);
        g.count++;
        g.formats.set(format, (g.formats.get(format) || 0) + 1);
      });

      const legacy = value && !value.byCamera ? { mode: value.mode || "keep", treatment: value.treatment || "auto" } : null;
      const list = [...byKey.values()].map((g) => ({
        ...g,
        format: [...g.formats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "?"
      }));
      const initialChoices = {};
      list.forEach((g) => { initialChoices[g.key] = value?.byCamera?.[g.key] || legacy || DEFAULT_CHOICE; });

      setGroups(list);
      setChoices(initialChoices);
      setLoading(false);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setChoice = (key, patch) => {
    setChoices((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || DEFAULT_CHOICE), ...patch } };
      const defaultChoice = groups[0] ? next[groups[0].key] : DEFAULT_CHOICE;
      onChange({ byCamera: next, default: defaultChoice });
      return next;
    });
  };

  useEffect(() => {
    if (groups.length) {
      const defaultChoice = choices[groups[0].key] || DEFAULT_CHOICE;
      onChange({ byCamera: choices, default: defaultChoice });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  if (loading) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
        <p className="text-sm font-medium text-zinc-100">Detectando cámaras de la cola</p>
        <p className="mt-5 flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {done} / {photos.length}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
        <p className="text-sm font-medium text-zinc-100">Perfil de cámara / Tratamiento</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {groups.length > 1
            ? `Se detectaron ${groups.length} cámaras distintas en esta cola. El tratamiento y el perfil se configuran por separado para cada una.`
            : "Elige cómo debe interpretar Lightroom estas fotografías."}
        </p>
      </div>

      {groups.map((g) => {
        const choice = choices[g.key] || DEFAULT_CHOICE;
        return (
          <div key={g.key} className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
            <p className="text-sm text-zinc-100">Cámara detectada: <span className="font-medium">{g.key}</span></p>
            <p className="text-xs text-zinc-500">Formato: {g.format} — {g.count} foto{g.count !== 1 ? "s" : ""}</p>

            <p className="mt-4 text-xs font-medium text-zinc-300">Tratamiento</p>
            <div className="mt-2 flex gap-2">
              {TREATMENTS.map((t) => (
                <label key={t.value}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs ${choice.treatment === t.value ? "border-white bg-zinc-900 text-zinc-100" : "border-zinc-800 text-zinc-400"}`}>
                  <input type="radio" name={`treatment-${g.key}`} className="hidden"
                    checked={choice.treatment === t.value} onChange={() => setChoice(g.key, { treatment: t.value })} />
                  {t.label}
                </label>
              ))}
            </div>

            <p className="mt-4 text-xs font-medium text-zinc-300">Perfil</p>
            <select value={choice.mode} onChange={(e) => setChoice(g.key, { mode: e.target.value })}
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
              {PROFILE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-zinc-500">{PROFILE_OPTIONS.find((o) => o.value === choice.mode)?.hint}</p>
          </div>
        );
      })}
    </section>
  );
}