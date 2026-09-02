// Fase 4.1 Checkpoint 2 — AUTOPRUEBA de sanitización SOLO con imagen sintética
// (nunca fotografías privadas de clientes): genera un canvas de prueba, lo pasa
// por sanitizeForAi y verifica límites y ausencia de metadatos byte a byte.
import { sanitizeForAi, dataUrlBytes } from "./sanitizer";

export function makeSyntheticImage(w = 1024, h = 768) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#2244aa");
  g.addColorStop(1, "#dd9955");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toDataURL("image/jpeg", 0.9);
}

function binaryOf(dataUrl) {
  return atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
}

export async function runSanitizerSelfTest() {
  const checks = [];
  const original = makeSyntheticImage();
  const t0 = performance.now();
  const s = await sanitizeForAi(original);
  const ms = Math.round(performance.now() - t0);
  const bin = binaryOf(s.dataUrl);
  const hasExif = bin.includes("Exif");
  const hasXmp = bin.includes("http://ns.adobe.com/xap") || bin.includes("ns.adobe.com");
  const hasGps = bin.includes("GPS");
  checks.push({ name: "resolución ≤ 512 px", ok: s.width <= 512 && s.height <= 512, detail: `${s.width}×${s.height}` });
  checks.push({ name: "peso ≤ 100 KB", ok: s.bytes <= 100 * 1024, detail: `${Math.round(s.bytes / 1024)} KB (original: ${Math.round(dataUrlBytes(original) / 1024)} KB)` });
  checks.push({ name: "sin EXIF (byte a byte)", ok: !hasExif, detail: hasExif ? "marcador encontrado" : "ausente" });
  checks.push({ name: "sin XMP", ok: !hasXmp, detail: hasXmp ? "marcador encontrado" : "ausente" });
  checks.push({ name: "sin GPS", ok: !hasGps, detail: hasGps ? "marcador encontrado" : "ausente" });
  checks.push({ name: "formato JPEG re-codificado", ok: s.dataUrl.startsWith("data:image/jpeg;base64,"), detail: "image/jpeg" });
  checks.push({ name: "latencia razonable", ok: ms < 3000, detail: `${ms} ms` });
  return {
    ok: checks.every((c) => c.ok),
    checks,
    sanitized_size: `${s.width}×${s.height}`,
    sanitized_bytes: s.bytes,
    ms,
    sample: s.dataUrl,
  };
}