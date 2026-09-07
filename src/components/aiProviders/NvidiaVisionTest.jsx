import { useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Diagnóstico de visión NVIDIA: envía UNA imagen de prueba (redimensionada a máx 512 px,
// JPEG sin EXIF/metadata) como data URL directa al endpoint de NVIDIA y muestra lo que
// "ve" el modelo. No usa UploadFile ni InvokeLLM. Nunca fotografías privadas: es una
// herramienta de diagnóstico de transporte.
function toBase64Preview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 512 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
      };
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export default function NvidiaVisionTest() {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const run = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const preview_base64 = await toBase64Preview(file);
      const res = await base44.functions.invoke("ai-providers", { action: "test-nvidia-vision", preview_base64 });
      setResult(res?.data ?? res);
    } catch (err) {
      setResult({ ok: false, reason: err.message });
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-3.5 w-3.5 text-accent" />
        <p className="text-sm font-medium">Probar visión NVIDIA (1 foto)</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Envía una imagen de prueba (redimensionada a 512 px, JPEG sin EXIF) como data URL directa y el modelo responde
        lo que ve. Sin UploadFile ni InvokeLLM.
      </p>
      <div>
        <input ref={inputRef} type="file" accept="image/*" onChange={run} className="hidden" />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Elegir imagen y probar
        </button>
      </div>
      {result && (
        <div className="space-y-1 text-xs">
          <p className={result.ok ? "text-emerald-600" : "text-red-500"}>
            {result.ok
              ? `Visión correcta (${result.http_status}, ${result.latency_ms}ms, ${result.model})`
              : `Falló: ${result.reason || `HTTP ${result.http_status}`}`}
          </p>
          {result.content_preview && <p className="text-muted-foreground break-words">El modelo ve: {result.content_preview}</p>}
        </div>
      )}
    </div>
  );
}