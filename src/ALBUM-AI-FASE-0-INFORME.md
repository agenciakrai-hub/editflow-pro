# EDITFLOW ALBUM AI — FASE 0: INFORME DE REVISIÓN
Fecha: 2026-09-02 · Estado: ANÁLISIS — SIN IMPLEMENTACIÓN. Nada del código actual ha sido modificado.

---

## 1. ESTRUCTURA ACTUAL DE EDITFLOW

### 1.1 Frontend (React + Vite, Tailwind)
- **Router** (`src/App.jsx`): rutas públicas (login, landing, ThankYou) + rutas protegidas dentro de `AppLayout` con `ProtectedRoute`. Cada herramienta = una ruta.
- **Hub de herramientas** (`src/pages/Hub.jsx`): array de tarjetas `tools[]` que solo navegan a rutas. **Punto natural de integración** para Album AI (añadir 1 entrada).
- **Módulos aislados** (`src/modules/`): `proyectos/`, `lightroom/`, `editor/`, `seleccion/`, `local/`, `cerebro/`, `exportacion/`. Cada carpeta contiene sus páginas, componentes, hooks y utilidades propias.
- **Librerías compartidas** (`src/lib/rawaistudio/`): extracción de previews RAW, pHash, agrupación de ráfagas, motores de selección/ajustes, sesión local.
- **Local-first**: los RAW nunca se suben. Previews embebidas decodificadas en navegador; handles de carpetas/catálogos en IndexedDB; sesión en `localSession`. Solo metadatos van a la base de datos.

### 1.2 Backend
- **Funciones** (`base44/functions/`): `editflow-engine` (motor agrupado con plugin Lua embebido), `rawAiSmartSelect`, `rawAiDedupCompare`, `rawAiVisualDevelop`, `rawAiHybridProfile`, `rawAiStudioAnalyze`, `styleGalleryAnalyze`, `ai-providers`, más pagos (`create-checkout`, `payments-webhook`).
- **Seam de proveedores IA** (`base44/shared/aiProviderAdapter.ts`): ruteo con failover automático (custom → qwen → gemini → nvidia → base44). Reutilizable por importación sin modificación.
- **Entidades** (RLS por usuario, `created_by_id`): Project, ProjectPhotoFingerprint, CatalogBinding, PresetRegistry, PhotographerStyle, PhotographerStyleProfile, StyleCorrectionRecord, Preset, ExportJob, ProjectProcessingJob, etc.

---

## 2. FLUJO ACTUAL DE FOTOGRAFÍAS

```
Carpeta RAW local (File System Access API)
  → Extracción de previews embebidas + fingerprints (pHash) + EXIF [cliente]
  → Proyecto en BD (solo metadatos) + ProjectPhotoFingerprint
  → Selección IA (culling por ráfagas: TOP_PICK/SELECT/REVIEW/REJECT)
  → Ajustes IA (revelado → XMP generado)
  → lr-push: cola LrJob (XMP en BD) [backend]
  → Plugin Lightroom "Sincronizar seleccionadas" escribe sidecars .xmp [Lua]
  → EDICIÓN FINAL DEL FOTÓGRAFO EN LIGHTROOM
  → (opcional) CollectIds / CollectCorrections → Cerebro (aprendizaje de estilo)
```

**Punto clave para Album AI**: las fotos finales editadas existen SOLO en el disco local del fotógrafo (JPEG/TIFF que él exporta, o RAW con sidecar). EditFlow no las tiene. El flujo con Lightroom es unidireccional (web→LR) salvo recopilaciones de metadatos.

### 2.1 Integración actual con Lightroom (NO TOCAR)
- Plugin Lua embebido en `editflow-engine` (acción `plugin` genera el ZIP).
- Emparejamiento por token (`LrToken`) + URL del servidor; `apiCall()` con header `X-LR-Token`.
- Menús: Sincronizar, Recopilar IDs, Recopilar correcciones, Configurar.
- Actualizar el plugin exige reinstalar carpeta + "Recargar" + reiniciar Lightroom Classic.

---

## 3. IMPORTACIÓN DE FOTOS DESDE LIGHTROOM — ANÁLISIS DE OPCIONES

| Opción | Descripción | Riesgo para lo existente | Veredicto |
|---|---|---|---|
| **A. Carpeta exportada + File System Access API** | El fotógrafo exporta desde LR a una carpeta JPEG (flujo que ya hace hoy); Album AI la abre con la misma API que ya usa NuevoProyectoPage | **Cero**: no toca plugin ni backend | ✅ **Recomendada para Fase 3 inicial** |
| B. Nueva acción en el plugin ("Enviar a Album AI") | Export LR programática (LrExportSession) + subida de previews | Medio: hay que tocar INFO_LUA (añadir archivo + línea de menú); reinstalación + reinicio LR | Evolución posterior; las acciones existentes quedan intactas |
| C. Carpeta vigilada/sincronizada | Watcher local que detecta nuevos JPEG | Complejidad extra (agente local) sin beneficio claro | Descartada por ahora |
| D. Sincronización por metadatos | El plugin sube paths/nombres y Album AI los empareja | Solo aporta identidad, no píxeles; ya resuelto con fingerprints | Parcial: el emparejamiento por pHash/nombre reutiliza lo existente |

**Recomendación**: empezar con A (100% aislada, cero riesgo). B como mejora de UX cuando el módulo esté validado, añadiendo SOLO un archivo Lua nuevo y una entrada de menú nueva (sin tocar Sync.lua, CollectIds.lua ni CollectCorrections.lua).

---

## 4. ARQUITECTURA PROPUESTA — MÓDULO INDEPENDIENTE `src/modules/album/`

```
EditFlow Core (router, layout, auth, hub)
   │  (solo: 1 import + 1 Route en App.jsx · 1 entrada en Hub.jsx)
   ▼
src/modules/album/  ← TODO lo de Album AI vive aquí
├── pages/          AlbumHubPage (lista de álbumes), AlbumEditorPage (editor)
├── manager/        AlbumProjectManager: alta/config del álbum
│                   (tamaño, ancho, alto, formato, páginas, máx fotos/lienzo, estilo)
├── selection/      PhotoSelectionEngine: análisis técnico + IA + dedup (pHash)
├── story/          StoryEngine: clasificación narrativa (categorías configurables
│                   por tipo de reportaje: boda, comunión, bautizo, familiar, evento…)
├── layout/          LayoutEngine: catálogo paramétrico de layouts
│                   (1 foto, 2, 3, 4, full-bleed, panorámica, hero+secundarias,
│                   minimalista, editorial) + asignador según orientación/importancia
├── editor/          CanvasEditor: lienzos editables (swap, tamaño, posición,
│                   recorte, cambiar layout, añadir/quitar/reordenar lienzos)
├── format/          .editflowalbum — formato interno JSON versionado
└── lib/             utilidades propias (ids, export/serialización)
```

### Backend nuevo (sin tocar `editflow-engine`)
- `base44/functions/album-engine/` — acciones propias (`layout-suggest`, `story-organize`, `canvas-regenerate`). Importa `aiProviderAdapter` (read-only) para reutilizar el failover de proveedores IA.
- **Entidades nuevas con prefijo `Album`** (RLS `created_by_id`, sin relación con entidades existentes):
  - `AlbumProject` — config del álbum + referencia a la sesión de fotos.
  - `AlbumPhoto` — metadatos de foto importada (nombre, orientación, pHash, scores).
  - `AlbumCanvas` — lienzos: layout_id, posiciones, recortes, orden, origen IA/manual.
- Local-first igual que el resto: píxeles en el disco del fotógrafo (handle IndexedDB), solo metadatos en BD.

### Formato `.editflowalbum`
JSON versionado (`format_version`): config del álbum, referencias a archivos originales (ruta relativa + fingerprint), lienzos con layout, posiciones, recortes, transformaciones, orden, decisiones IA y ediciones manuales posteriores. Exportable/importable como archivo. Reserva de campo `export_targets` para la futura exportación (PDF/JPG/TIFF/imprenta) — no se implementa ahora.

---

## 5. RIESGOS Y DEPENDENCIAS

| Elemento | ¿Se toca? | Riesgo |
|---|---|---|
| `src/App.jsx` | 1 import + 1 Route (aditivo) | Mínimo |
| `src/pages/Hub.jsx` | 1 entrada en array `tools` (aditivo) | Mínimo |
| Plugin Lightroom / `editflow-engine` | **NO** en Fases 0–2 | Solo en Fase 3b (opcional), aditivo |
| Motor de selección, Ajustes IA, Cerebro, presets | **NO** | Nulo |
| Entidades existentes | **NO** — solo entidades nuevas `Album*` | Nulo |
| Proveedores IA (`aiProviderAdapter`) | Import, sin modificación | Nulo; ojo con consumo de créditos IA |
| Rendimiento | Álbumes = cientos de JPEG en navegador | Mitigable: previews reducidas + grid virtualizada + caché IndexedDB |
| Versiones publicadas | Cambios de backend requieren publicar | Proceso ya conocido |

**Garantía de aislamiento**: si Album AI falla, se desactiva su ruta/entrada del Hub y todo lo demás sigue igual. Ninguna entidad, función o flujo existente depende del módulo nuevo.

---

## 6. PLAN DE DESARROLLO POR FASES

- **FASE 0 — Revisión** ✅ (este informe). A la espera de aprobación.
- **FASE 1 — Diseño** (sin código funcional): schemas `Album*`, especificación del catálogo de layouts (paramétrico, con variantes), spec del formato `.editflowalbum`, diseño de flujo de datos y wireframes del editor.
- **FASE 2 — Prototipo del editor** (sin IA, sin Lightroom): gestión de proyecto de álbum, importación manual de carpeta JPEG, Canvas Editor con edición manual completa, guardado/carga `.editflowalbum`. Layouts deterministas sin IA.
- **FASE 3 — Integración Lightroom**: 3a) carpeta exportada LR + File System Access (cero riesgo); 3b opcional) nueva acción de menú del plugin (aditiva).
- **FASE 4 — IA**: selección inteligente → narrativa → asignación de layouts → generación automática del álbum completo.
- **FASE 5 (futuro)** — regeneración por lienzo (propuestas A/B/C) y exportación (PDF/JPG/TIFF/imprenta).

---

## 7. ELEMENTOS QUE DEBEN PERMANECER INTACTOS

- `editflow-engine` y todas sus acciones actuales (lr-push, lr-pending, zip-xmp, plugin, style-corrections…).
- Plugin Lua: Sync.lua, CollectIds.lua, CollectCorrections.lua, Settings.lua.
- Flujo RAW → Selección → Ajustes IA → Lightroom.
- Entidades existentes y sus RLS.
- Cerebro, estilos, presets, pagos, historial.
- SmartSelectionEngine y motores de revelado.

**Regla absoluta acordada**: antes de tocar cualquier archivo existente fuera de los 2 puntos aditivos (App.jsx/Hub.jsx), detenerse y explicar qué, por qué, riesgo, afectación y alternativa.