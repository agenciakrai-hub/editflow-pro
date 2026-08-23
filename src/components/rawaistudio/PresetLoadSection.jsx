import { useRef, useState } from "react";
import { FileUp } from "lucide-react";

export default function PresetLoadSection({ presetFile, onLoaded }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);

  const onPick = (file) => {
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => onLoaded(String(reader.result), file);
    reader.onerror = () => setError("No se pudo leer el archivo .xmp");
    reader.readAsText(file);
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#141414] p-6">
      <p className="text-sm font-medium text-zinc-100">Preset XMP base</p>
      <p className="mt-2 text-xs text-zinc-500">
        Se usa como plantilla: todo lo que no toque la IA permanece exactamente igual.
      </p>
      <input ref={inputRef} type="file" accept=".xmp" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])} />
      <button onClick={() => inputRef.current?.click()}
        className="mt-3 inline-flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-700">
        <FileUp className="h-3.5 w-3.5" /> {presetFile ? "Cambiar preset" : "Subir preset .xmp"}
      </button>
      {presetFile && <p className="mt-2 text-xs text-zinc-500">Cargado: {presetFile.name}</p>}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}