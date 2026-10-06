import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

export default function KraiPhotoEditor({ provider }) {
  const models = (provider.edicion_models || []).filter(id =>
    provider.available_models_meta?.some(m => m.id === id && m.caps?.image_edit === true));
  const [model, setModel] = useState("");
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState("Corrige la luz y el color conservando la composición y los detalles.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  useEffect(() => { if (!models.includes(model)) setModel(models[0] || ""); }, [models.join("|"), model]);
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, [result]);
  const chooseFile = e => {
    setResult(null); setError("");
    const next = e.target.files?.[0];
    if (!next) { setFile(null); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type) || next.size > 8 * 1024 * 1024) {
      setFile(null); e.target.value = ""; setError("Selecciona PNG, JPEG o WebP de hasta 8 MiB."); return;
    }
    setFile(next);
  };
  const edit = async () => {
    if (busy || !file || !model || !prompt.trim()) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("No se pudo leer la fotografía."));
        reader.readAsDataURL(file);
      });
      const response = await base44.functions.invoke("ai-providers", {
        action: "edit-image", id: provider.id, model, prompt,
        image_b64: b64, image_mime_type: file.type,
      });
      const data = response.data;
      if (!data?.ok) throw new Error(data?.reason || "No se pudo editar la fotografía.");
      const image = data.artifacts?.find(a => a.type === "image");
      if (!image) throw new Error("La respuesta no contiene una fotografía.");
      const bytes = Uint8Array.from(atob(image.data_b64), c => c.charCodeAt(0));
      const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[image.mime_type];
      if (!ext) throw new Error("Formato de resultado no compatible.");
      setResult({ url: URL.createObjectURL(new Blob([bytes], { type: image.mime_type })),
        name: file.name.replace(/\.[^.]+$/, "") + "-gemini." + ext });
    } catch (e) { setError(e.message || "No se pudo editar la fotografía."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-t pt-4" aria-label="Editar fotografía con Gemini Web nuevo">
    <h3 className="font-semibold">Editar fotografía con Gemini Web nuevo</h3>
    {!models.length ? <p className="text-sm text-muted-foreground">Marca un motor en Edición y pulsa Guardar para empezar.</p> : <>
      <label className="block text-sm">Motor de edición
        <select aria-label="Motor de edición" className="block w-full rounded border bg-background p-2" value={model} onChange={e => setModel(e.target.value)} disabled={busy}>
          {models.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label className="block text-sm">Fotografía (PNG, JPEG o WebP, hasta 8 MiB)
        <input aria-label="Fotografía para Gemini" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} disabled={busy} className="block" />
      </label>
      <label className="block text-sm">Instrucciones de edición
        <textarea aria-label="Instrucciones de edición" maxLength={20000} className="block w-full rounded border bg-background p-2" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} />
      </label>
      <p className="text-xs text-muted-foreground">La fotografía se envía a Gemini mediante KRAI. La descarga conserva el archivo recibido.</p>
      <button type="button" className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={edit} disabled={busy || !file || !prompt.trim()}>{busy ? "Editando fotografía…" : "Editar fotografía"}</button>
    </>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {result && <div className="space-y-2"><img alt="Fotografía editada por Gemini" src={result.url} className="max-h-96 w-full object-contain" /><a className="underline" href={result.url} download={result.name}>Descargar fotografía editada</a></div>}
  </section>;
}
