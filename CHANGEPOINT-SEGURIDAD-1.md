# Punto de Seguridad · SEGURIDAD 1

**Fecha de generación:** 2026-09-02 (Europe/Madrid)
**Estado:** Código completo, funcional, con datos guardados hasta hoy.

---

## 1. Propósito

Punto de control de referencia. Marca el momento en que la aplicación EditFlow Pro
está operativa al completo: todos los módulos funcionan y los datos persisten en la
base de datos. Si una modificación posterior rompe algo, este documento (+ el backup
de datos asociado) permite reconstruir el estado conocido y bueno.

---

## 2. Módulos funcionales (frontend)

| Módulo / Página | Ruta | Estado |
|---|---|---|
| Landing | `/` | ✅ |
| Selección IA (culling) | `/dashboard` | ✅ |
| Lightroom (plugin + push) | `/lightroom` | ✅ |
| Hub de herramientas | `/herramientas` | ✅ |
| Mis proyectos | `/proyectos` | ✅ |
| Nuevo proyecto | `/proyectos/nuevo` | ✅ |
| Detalle de proyecto | `/proyectos/:id` | ✅ |
| Ajustes IA (revelado) | `/ajustes-ia` | ✅ |
| Preset XMP | `/preset-xmp` | ✅ |
| Proveedores IA | `/proveedores-ia` | ✅ |
| Estilos | `/estilos` | ✅ |
| Cerebro | `/cerebro` | ✅ |
| Historial de trabajos | `/historial` | ✅ |
| Suscripción | `/suscripcion` | ✅ |
| Admin | `/admin` | ✅ |

---

## 3. Funciones backend

- `ai-providers` — configuración/test de proveedores IA.
- `create-checkout` — checkout Base44 Payments (Wix).
- `editflow-engine` — motor agrupado: export, zip-xmp, process, sync, plugin, lr-*,
  style-corrections y **seguridad-backup** (añadido en este punto de control).
- `payments-webhook` — webhook de pagos (ORDER_APPROVED).
- `rawAiDedupCompare` — comparación visual de casi-duplicados entre grupos.
- `rawAiHybridProfile` — perfil de sesión híbrido (1 llamada IA).
- `rawAiSmartSelect` — culling IA comparativo por ráfaga.
- `rawAiStudioAnalyze` — análisis individual de foto.
- `rawAiVisualDevelop` — revelado IA visual completo.
- `styleGalleryAnalyze` — análisis de estilo desde galería.

---

## 4. Proveedores IA (configuración activa)

- **Selección IA activa:** `nvidia` (minimaxai/minimax-m3)
- **Ajustes IA activa:** `nvidia` (minimaxai/minimax-m3)
- **Qwen:** habilitado · modelo `qwen3-vl-plus`
- **NVIDIA:** habilitado · modelo `minimaxai/minimax-m3`
- **Gemini:** habilitado · modelo `gemini-3.6-flash`
- **Base44 (InvokeLLM):** habilitado (último recurso en failover)
- **Custom:** OpenRouter · `openai/gpt-4o-2024-11-20` · enabled · last_ok=true

Failover automático activo: si el proveedor activo falla, reintenta con el siguiente
habilitado (custom → qwen → gemini → nvidia → base44).

---

## 5. Datos guardados (conteos a fecha 2026-09-02)

| Entidad | Registros |
|---|---|
| Project | 4 |
| ProjectPhotoFingerprint | 2.912 |
| PresetRegistry | 4 |
| PhotographerStyle | 1 |
| Preset | 5 |
| ExportJob | 0 |
| CatalogBinding | 5 |
| PhotographerStyleProfile | 1 |
| StyleCorrectionRecord | 0 |
| ProjectProcessingJob | 1 |
| Base44Purchase | 1 |
| AiProviderConfig | 1 |
| CustomAiProvider | 1 |
| LrJob | 1.359 |
| LrToken | 2 |
| LrCatalogSnapshot | 0 |

### Proyectos
| Título | Estado | Fotos | Seleccionadas | Selección guardada | Creado |
|---|---|---|---|---|---|
| assa | editing | 963 | 234 | sí | 2026-09-02 |
| assa | draft | 963 | 0 | no | 2026-09-02 |
| PREBODA CURRO Y CELIA | draft | 963 | 0 | no | 2026-09-02 |
| fghgh | draft | 0 | 0 | no | 2026-08-22 |

---

## 6. Backup de datos

Acción `seguridad-backup` del motor `editflow-engine` vuelca TODAS las entidades a un
JSON y lo sube a almacenamiento, devolviendo una URL de descarga.

Para regenerar el backup descargable:
```
await base44.functions.invoke('editflow-engine', { action: 'seguridad-backup' })
// → { ok, checkpoint: 'SEGURIDAD-1', counts, downloadUrl }
```

---

## 7. Decisión técnica reciente

Re-selección en proyecto: al pulsar "Selección" de nuevo, TODAS las fotos se resetean
a estado neutro (sin selección, rating, etiqueta ni color) antes de que la IA re-analice
desde cero. El guardado sobrescribe los registros anteriores por completo (una
actualización por cada foto). Garantiza que la re-selección no arrastra estados previos.