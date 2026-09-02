# EDITFLOW ALBUM AI — FASE 1: DISEÑO Y ESPECIFICACIÓN
Fecha: 2026-09-02 · Estado: DISEÑO APROBADO CONDICIONALMENTE — SIN IMPLEMENTACIÓN.
No se ha creado ni modificado ningún archivo de código, entidad, backend o plugin.

---

# 1. ARQUITECTURA PROPUESTA

## 1.1 Principio rector

- **El editor manual es el núcleo; la IA es una capa opcional encima.** Todo el diseño
  funciona sin IA (modo MANUAL). El modo AI solo añade: selección, narrativa, propuesta
  de maquetación y regeneración de spread.
- **Aislamiento total**: todo vive en `src/modules/album/` + función `album-engine` +
  entidades con prefijo `Album`. Si el módulo falla o se desactiva (quitando su ruta y su
  tarjeta del Hub), el resto de EditFlow funciona exactamente igual.
- **No destructivo**: los JPEG/TIFF originales son solo-lectura. Se guardan
  transformaciones virtuales (posición/escala/rotación/crop) + referencias al archivo.

## 1.2 Estructura conceptual

```
src/modules/album/
├── pages/
│   ├── AlbumsPage.jsx          Lista de álbumes + crear nuevo (B y C de wireframes)
│   └── AlbumEditorPage.jsx     Shell 3 paneles (D/E/F) — solo orquesta
├── manager/
│   ├── albumManager.js         CRUD AlbumProject, config, unidades, preset de tamaño
│   └── albumStore.js           Estado del documento abierto + undo/redo + autosave
├── import/
│   └── folderImport.js         File System Access API: carpeta → catálogo + previews
├── photos/
│   └── photoCatalog.js         Catálogo: todas vs recomendadas, estados, recuperación
├── spreads/
│   └── spreadManager.js        Crear/eliminar/reordenar spreads, asignar layout
├── layout/
│   ├── layoutCatalog.js        LAYOUT LIBRARY — datos puros (JSON), no componentes
│   └── layoutEngine.js         Validador + aplicador genérico (motor único)
├── editor/
│   ├── SpreadCanvas.jsx        Render del spread (canvas/DOM), guías, interacción
│   ├── SlotFrame.jsx           Foto + transformaciones + crop virtual
│   ├── PhotoPanel.jsx          Panel izquierdo (fotos disponibles/recomendadas)
│   ├── LayoutPanel.jsx         Panel derecho (layouts compatibles + propiedades)
│   ├── SpreadToolbar.jsx       Zoom/pan/deshacer/rehacer/crear spread/guías
│   └── AlbumOverview.jsx       Vista general con miniaturas de todos los spreads
├── format/
│   └── albumFile.js            Serialización .editflowalbum (v1) — exportar/importar
├── ai/                          (FASE 4 — reservado)
│   ├── selectionEngine.js
│   ├── storyEngine.js
│   └── proposalEngine.js
└── lib/
    ├── albumUnits.js           mm↔px, DPI, presets de tamaño, sangrado/márgenes/gutter
    └── previewStore.js        Previews reducidas en IndexedDB (patrón ya usado)

base44/functions/album-engine/   (FASE 4 — reservado; importa aiProviderAdapter)
```

**Justificación de nombres**: se unifica "Canvas" en `SpreadCanvas` (la unidad editable
es el spread, no un canvas abstracto) y se añade `photoCatalog` (los dos niveles de
fotografías del punto 9 del pliego). El resto coincide con la propuesta del usuario.

## 1.3 Reglas de dependencia

- `album/` puede IMPORTAR utilidades genéricas existentes (nada por ahora; ni siquiera
  es necesario: `previewCache`/`idbHandles` sirven como patrón, y en Fase 2 se crean
  utilidades propias dentro del módulo).
- NADA existente importa nada de `album/`. Dependencia unidireccional → aislamiento.
- Los layouts son **datos** (`layoutCatalog.js`): añadir "Layout 047 editorial" = añadir
  un objeto JSON, sin tocar `layoutEngine.js` ni componentes.

---

# 2. SPREAD COMO UNIDAD PRINCIPAL — ANÁLISIS

**Decisión: SÍ, el spread (doble página) es la unidad principal de trabajo.** El modelo
de datos también admite spreads de página única (portada, contraportada, página de
dedicatoria) mediante `mode: "spread" | "page_left" | "page_right"`.

Ventajas técnicas:
1. **Coincide con el producto físico**: los álbumes se fabrican y se presupuestan por
   doble página; el fotógrafo piensa "este spread = la ceremonia entera".
2. **Narrativa por spread**: la unidad de storytelling es la doble página (una escena o
   beat por spread), no la página suelta — clave para el futuro Story Engine.
3. **Continuidad visual en el centro**: composiciones que cruzan el gutter (full-bleed a
   doble página, foto panorámica) solo se pueden diseñar/validar sobre el spread entero.
4. **Menos estado**: 1 registro de spread con N slots ≪ 2 páginas + reglas de
   emparejamiento. Reordenar álbum = reordenar spreads.
5. **Comparables a la industria**: los maquetadores profesionales (SmartAlbums, Fundy)
   trabajan sobre spreads; el fotógrafo ya tiene este modelo mental.

Contras asumidos: la portada y páginas sueltas necesitan el modo `page_*` (resuelto) y
el render necesita marcar el gutter visualmente (coste menor).

Geometría del spread (todas las magnitudes en mm, ver §4):
```
┌ sangrado ────────────────────────────────────┐
│  ┌ margen ─── gutter ┬─ gutter ─── margen ┐  │
│  │   PÁG. IZQ.       │      PÁG. DER.     │  │
│  │   zona segura     │    zona segura     │  │
│  └───────────────────┴────────────────────┘  │
└──────────────────────────────────────────────┘
ancho_spread = 2 × ancho_página + gutter (modo spread)
```

---

# 3. TAMAÑOS FLEXIBLES — REPRESENTACIÓN INTERNA

- **Unidad canónica: milímetros (número decimal)**. Todo cálculo y almacenamiento en mm.
- El editor renderiza en px: `px = mm × dpi / 25.4` (DPI por defecto 300; el DPI es
  propiedad del álbum, no global).
- **Orientación derivada, no almacenada**: `square` si |ancho−alto| < 1 mm; si no,
  `landscape`/`portrait`. Evita estados contradictorios al editar dimensiones.
- Presets (`layoutCatalog`/`albumUnits`): 30×30, 25×35, 35×25, 40×30, 30×40, 20×20,
  20×30 + `custom` (ancho/alto libres). Un preset es solo `{name, w, h}` — añadir
  tamaños no toca código de motor.
- Validaciones mínimas: w,h ∈ [100, 500] mm; márgenes y gutter en mm; sangrado por
  defecto 3–5 mm según preset.

---

# 4. MODELO DE DATOS CONCEPTUAL

Cuatro entidades (ninguna creada aún). Todas con RLS `created_by_id` (patrón idéntico a
las existentes) y prefijo `Album` para colisión cero.

## AlbumProject
Propósito: configuración y estado del álbum.
```
id, created_date, updated_date, created_by_id          (integrados)
name: string
event_type: string ("wedding" | "communion" | "baptism" | "family" | "event" | "other")
status: "draft" | "imported" | "designing" | "ai_proposed" | "reviewed" | "final"
width_mm, height_mm: number
dpi: number (default 300)
bleed_mm, margin_mm, gutter_mm: number
size_preset: string ("30x30" | ... | "custom")
spread_count_target: number (páginas APROXIMADAS, guía para la IA, no límite duro)
max_photos_per_spread: number (default 6)
style_hint: string ("minimal" | "editorial" | "classic" | "modern")
source_folder_name: string (informativo; el handle real vive en IndexedDB)
doc_version: string ("v1")           — versión del esquema .editflowalbum
```

## AlbumPhoto
Propósito: catálogo de fotos importadas (los DOS niveles del punto 9).
```
id, project_id → AlbumProject
filename, relative_path: string
orientation: "landscape" | "portrait" | "square"
phash: string (dedup, igual criterio que ProjectPhotoFingerprint)
capture_time: number (epoch ms, para narrativa)
preview_status: "ok" | "missing"
ai_state: "recommended" | "considered" | "discarded" | "unreviewed" (default "unreviewed")
ai_rank: number | null            — ranking IA futuro
ai_scores: object | null          — nitidez/enfoque/expresión/… futuro
ai_category: string | null         — "ceremonia", "preparativos", … futuro
```
`ai_state` es metadata: el fotógrafo puede usar CUALQUIER foto en cualquier momento,
recuperar descartadas y sustituir las de la IA. La IA nunca bloquea (punto 10).

## AlbumSpread
Propósito: cada spread del álbum, con su layout y slots.
```
id, project_id → AlbumProject
order_index: number
mode: "spread" | "page_left" | "page_right"
layout_id: string ("L001", …, "custom")
slots: [ Slot ]                   — array embebido (ver abajo)
locked: boolean (default false)   — el fotógrafo puede blindar un spread frente a la IA
ai_generated: boolean
```
```
Slot = {
  slot_id: string,
  photo_id → AlbumPhoto | null,
  x_mm, y_mm, w_mm, h_mm: number,      — marco del slot dentro del spread
  transform: {
    scale: number (1 = fit),
    offset_x_mm, offset_y_mm: number,   — pan dentro del marco
    rotation: number (grados, futuro),
    crop: { x, y, w, h } | null         — crop virtual normalizado 0..1
  },
  fit_mode: "fill" (crop para llenar) | "fit" (contener)
  z_index: number
}
```
Transform = solo números referidos a la ORIGINAL; el JPEG nunca se toca.

## AlbumAIJob (Fase 4 — reservada)
Propósito: trazabilidad de cada propuesta IA (auditoría y regeneraciones).
```
id, project_id, kind: "selection" | "story" | "layout" | "spread_regenerate"
status: "pending" | "completed" | "failed"
input_snapshot / output_snapshot: object
provider_used: string
```

**No hay entidad AlbumLayout**: los layouts son la LAYOUT LIBRARY en código (datos JSON),
versionados con el propio módulo. Un álbum guarda `layout_id` + la geometría COPiada en
sus slots → los álbumes nunca se rompen si un layout se edita o elimina del catálogo.

**Relaciones**: AlbumProject 1—N AlbumPhoto, AlbumProject 1—N AlbumSpread,
AlbumSpread 1—N Slot (embebido), AlbumPhoto 1—N Slots (referencia). Sin dependencias con
NINGUNA entidad existente de EditFlow.

---

# 5. LAYOUT LIBRARY

## 5.1 Formato de definición de layout (dato, no componente)
```js
{
  id: "L004",
  name: "Hero + 3 secundarias",
  family: "editorial",            // minimal | editorial | classic | modern
  mode: "spread",
  min_photos: 4, max_photos: 4,
  orientations: ["landscape", "square", "portrait"],   // orientación de ÁLBUM compatible
  photo_hints: { hero: ["landscape", "square"], secondary: ["portrait", "landscape"] },
  slots: [
    { slot_id: "s1", x_mm: 0, y_mm: 0, w_mm: "page_w",  h_mm: "page_h*0.6", role: "hero" },
    { slot_id: "s2", x_mm: "page_w", y_mm: "page_h*0.6", w_mm: "page_w/2",  h_mm: "page_h*0.4", role: "secondary" },
    // s3, s4…
  ],
  rules: { allow_crop: true, min_zoom: 1, full_bleed_slots: ["s1"] }
}
```
- Coordenadas en **expresiones sobre variables del álbum** (`page_w`, `page_h`,
  `margin`, `gutter`) → el mismo layout sirve para 30×30 y 25×35 sin duplicar definiciones.
- `role` (hero/secondary) guía a la futura IA: foto principal → slot hero.

## 5.2 Catálogo inicial (Fase 2) — 10–14 layouts
L001 full-bleed doble página · L002 1 foto por página (2) · L003 4 en grid 2×2 ·
L004 hero + 3 · L005 hero izquierda + 1 vertical derecha · L006 panorámica arriba +
2 abajo · L007 3 verticales · L008 minimal (1 foto pequeña centrada) · L009 editorial
5–6 · L010 página única. Más familias (clásicas, modernas, por tipo de reportaje) en el
futuro = solo añadir datos.

## 5.3 LayoutEngine (motor único, genérico)
- `validate(layout, album)` — min/max, orientación, slots válidos.
- `apply(layout, spread, photos)` — asigna fotos a slots según `photo_hints` (en manual:
  por orden de colocación; en IA: por ranking). Reescribe `slots[]` con geometría resuelta.
- `compatibleLayouts(album, nPhotos)` — filtra el catálogo → panel derecho del editor.
- No conoce React ni IA: pura geometría + datos → testeable aislado.

---

# 6. ESPECIFICACIÓN `.editflowalbum` (formato v1)

Archivo JSON (UTF-8), extensión `.editflowalbum`, schema versionado.

```jsonc
{
  "format_version": 1,
  "kind": "editflow-album",
  "project": { "id", "name", "event_type", "created_date", "status" },
  "album": {
    "width_mm", "height_mm", "dpi", "bleed_mm", "margin_mm", "gutter_mm",
    "size_preset", "spread_count_target", "max_photos_per_spread", "style_hint"
  },
  "photos": [ {
    "photo_id", "filename", "relative_path", "orientation", "phash",
    "capture_time", "ai_state", "ai_rank", "ai_scores", "ai_category"
  } ],
  "spreads": [ {
    "spread_id", "order_index", "mode", "layout_id", "locked", "ai_generated",
    "slots": [ { "slot_id", "photo_id", "x_mm", "y_mm", "w_mm", "h_mm",
                 "transform": { "scale", "offset_x_mm", "offset_y_mm", "rotation", "crop" },
                 "fit_mode", "z_index" } ]
  } ],
  "ai": {                       // estructura futura RESERVADA (siempre presente, null)
    "selection": null, "story": null, "layout_decisions": null
  },
  "export_targets": null        // futuro: PDF/JPG/TIFF/imprenta — reservado
}
```
Reglas: las coordenadas de slot se materializan en mm (autonomía total del archivo);
las fotos se referencian por `relative_path` + `phash` (re-localización por huella);
previews NO van dentro del archivo (se regeneran de la carpeta). Importar = validar
`format_version` ≤ actual y reconstruir estado.

---

# 7. IMPORTACIÓN DESDE LIGHTROOM (carpeta local) — FLUJO

```
LR: Exportar (JPEG sRGB, calidad 90, tamaño export definido por el fotógrafo)
   → CARPETA LOCAL (ej. /Álbumes/Boda Curro y Celia)
   → Album AI: showDirectoryPicker() (File System Access API)
   → Persistencia del handle en IndexedDB (patrón idbHandles ya existente, copiado al módulo)
   → Escaneo: extensiones jpg/jpeg/png/tiff, ignora ocultos/sistema
   → Por foto: preview reducida (maxEdge ~640px, canvas → blob) a IndexedDB
      + pHash (mismo algoritmo perceptualHash, reutilizado como patrón)
      + orientación desde dimensiones reales + capture_time si EXIF disponible
   → Catálogo visible al instante (PhotoPanel), originals intactos (solo lectura)
```

**Permisos**: `read` (nunca `readwrite`). El handle se re-pide tras reinicio del
navegador (`queryPermission/requestPermission`), igual que en proyectos actuales.

**Foto desaparecida o movida**: `preview_status: "missing"`; el spread muestra el slot
con placeholder + aviso; se ofrece "Re-localizar carpeta" (re-pick de carpeta y
re-emparejamiento por `phash` + nombre, mismas reglas de ambigüedad → revisión manual).
El álbum NUNCA se corrompe: slots, transforms y orden persisten aunque falte el píxel.

**Fase 3b futura (documentada, NO implementar)**: nueva acción de menú del plugin
"Enviar selección a Album AI" (LrExportSession → JPEG a carpeta elegida) — archivo Lua
nuevo + 1 línea de menú, sin tocar Sync/CollectIds/CollectCorrections.

---

# 8. WIREFRAMES CONCEPTUALES

## A. Acceso desde el Hub (Fase 2: 1 entrada aditiva al array `tools`)
```
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
│  Proyectos         │ │  Selección         │ │  Ajustes IA        │
└────────────────────┘ └────────────────────┘ └────────────────────┘
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
│ ▣ ALBUM AI (nuevo) │ │  Preset XMP        │ │  Cerebro           │
│  Álbumes con       │ └────────────────────┘ └────────────────────┘
│  editor de spreads │
└────────────────────┘
```

## B. Crear álbum
```
┌───────────────────────────────────────────────────┐
│  NUEVO ÁLBUM                                       │
│  Nombre [Boda Curro y Celia        ]               │
│  Tipo de reportaje (boda ▾ / comunión / bautizo…)  │
│  Tamaño: (● 30×30) ( 25×35) ( 40×30) ( 20×30)…     │
│          (○ Personalizado → [ancho][alto] cm)     │
│  Sangrado [3]mm · Márgenes [10]mm · Gutter [6]mm   │
│  Spreads aprox. [20] · Máx fotos/spread [6]        │
│  Estilo: (● minimal) ( editorial) ( clásico)…     │
│                       [ Cancelar ] [ Crear álbum ] │
└───────────────────────────────────────────────────┘
```

## C. Importar fotografías
```
┌───────────────────────────────────────────────────┐
│  IMPORTAR CARPETA                                   │
│  [ 📁 Seleccionar carpeta de fotos exportadas ]     │
│  ⏳ Escaneando… 128/512  ██████░░░░░░               │
│  ✅ 512 fotos · previews generadas · 3 duplicados   │
│  Catálogo listo → [ Ir al editor ]                  │
└───────────────────────────────────────────────────┘
```

## D. Vista general del álbum (AlbumOverview)
```
┌───────────────────────────────────────────────────┐
│ Boda Curro y Celia · 30×30 · 18 spreads · 96 fotos │
│ [ + Nuevo spread ] [ Vista general | Editor ]     │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│ │  1  │ │  2  │ │  3  │ │  4  │ │  5  │  ← drag   │
│ │ 4f  │ │ 6f  │ │ 1f  │ │ 2f  │ │ 5f  │    reorder│
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
└───────────────────────────────────────────────────┘
```

## E. Editor de spread
```
┌────────────┬──────────────────────────────┬────────────┐
│ FOTOS      │  SPREAD 3/18     [L004]     │ LAYOUTS    │
│ (Rec. 96 ▾)│  zoom − [100%] + · ↺ ↻       │ L001 ●     │
│ ┌───┐┌───┐│ ┌──────────────┬───────────┐ │ L004 ●     │
│ │ ▣ ││ ▣ ││ │              │           │ │ L006 ○     │
│ └───┘└───┘│ │   HERO       │  s2 ▣     │ │ L009 ○     │
│ ┌───┐┌───┐│ │              ├───────────┤ │────────────│
│ │ ▣ ││ ▣ ││ ├──────────────┤ s3 │ s4 ▣ │ │ PROPIEDADES│
│ └───┘└───┘│ │              │    │      │ │ s1: fill   │
│ (Ver todas │ └──────────────┴───────────┘ │ scale 1.0  │
│  512)      │  [ ◧ guías: sangrado·margen· │ crop…      │
│            │      zona segura · gutter ]  │ [🔒 lock]  │
└────────────┴──────────────────────────────┴────────────┘
  Panel izq: arrastrar foto → slot · click slot → props
  Arrastrar dentro del slot = pan · rueda sobre slot = zoom · handles = resize/crop
```

## F. Panel de IA (Fase 4 — solo diseño)
```
┌─────────────────────────────┐
│ ASISTENTE IA                │
│ [ Seleccionar fotos ]       │  → 512 → ~250 recomendadas
│ [ Organizar narrativa ]     │  → categorías + orden
│ [ Generar propuesta ]       │  → spreads 1..N auto
│ [ Regenerar este spread ]   │  → A / B / C
│ Estado: 18 spreads · IA 90% │
└─────────────────────────────┘
```

---

# 9. CANVAS EDITOR — ESPECIFICACIÓN FUNCIONAL (Puntos 2, 12)

Prioridad MANUAL completa, sin IA:
1. **Spreads**: seleccionar, crear (nuevo en blanco / con layout), eliminar, reordenar
   (drag en overview y en toolbar ◀▶), duplicar.
2. **Fotos**: añadir (drag desde panel izquierdo a slot o al spread), eliminar del
   slot, sustituir (drop sobre slot ocupado), mover entre slots (drag slot→slot).
3. **Transformación por slot**: pan dentro del marco (drag), zoom (rueda/ ± botones,
   `fit_mode: fill|fit`), crop virtual con handles (nunca toca el original), escala del
   marco, z_index (foto sobre foto en layouts solapados futuros).
4. **Layouts**: cambiar layout (compatibles con nº de fotos y orientación), añadir/
   quitar slot en modo `custom`, reset del layout.
5. **Vista**: zoom del spread (fit / 25–400%), pan del lienzo, guías conmutables
   (sangrado, márgenes, zona segura, gutter), modo "sin guías" para ver el resultado.
6. **Historial**: undo/redo del documento (stack de snapshots del estado de spreads;
   límite ~50 pasos), autosave a BD con debounce (patrón ya usado) + guardado manual.
7. **Persistencia**: cada cambio → AlbumSpread/AlbumPhoto en BD (metadatos) y
   exportable/importable como `.editflowalbum` en cualquier momento.

Interacciones prohibidas: escribir en la carpeta de fotos (permiso read-only), y la IA
no puede modificar spreads con `locked: true`.

---

# 10. LA IA COMO CAPA OPCIONAL (diseño, Fase 4)

- **Funnel (punto 8)**: 512 importadas → selección IA (rank técnico + visual:
  nitidez, enfoque, exposición, expresión, momento, composición; dedup por pHash +
  comparación visual, mismo criterio conservador que el culling actual) → ~250
  recomendadas (`ai_state: recommended`) → maquetación usa 100–120 según
  `spread_count_target`. TODAS siguen en el catálogo ("Ver todas") y pueden entrar al
  álbum en cualquier momento (punto 10: la IA nunca bloquea).
- **Narrativa (punto 8b)**: categorías por `event_type` (boda: preparativos, detalles,
  vestido, ceremonia, pareja, familia, fiesta…; comunión, bautizo, familiar, evento con
  sus propias listas) → orden temporal (capture_time) + coherencia → 1–2 "beats" por
  spread. Configurables como datos, no en código (futuro: `event_type` solo cambia la
  lista de categorías aplicada).
- **Maquetación**: IA elige fotos por spread (hero/secondary) y layout del catálogo
  (`compatibleLayouts`) → LayoutEngine aplica. La IA nunca posiciona píxeles: usa
  layouts profesionales → nunca aleatorio.
- **Regeneración**: por spread, 3 propuestas (A/B/C) → el usuario elige o descarta.
- **Backend**: función `album-engine` con acciones `select-photos`, `organize-story`,
  `propose-album`, `regenerate-spread` → importa `aiProviderAdapter` (failover actual,
  sin modificarlo). Jobs en `AlbumAIJob` para trazabilidad.

---

# 11. RIESGOS Y DEPENDENCIAS

| Riesgo | Prob. | Mitigación |
|---|---|---|
| Modificar App.jsx/Hub.jsx rompe algo | Muy baja | Cambios 100% aditivos (1 import+1 Route; 1 objeto al array); rollback = quitar esas líneas |
| Rendimiento con 500+ previews | Media | Previews ≤640px en IndexedDB, carga perezosa, miniaturas pequeñas; medir en prototipo |
| Crop/zoom impreciso en pantallas HiDPI | Media | Todo el modelo en mm + factor DPI explícito; tests de unidades |
| File System Access API no disponible (Firefox/Safari antiguos) | Baja | Detección + aviso claro; input webkitdirectory como alternativa de solo-importar |
| Fotos movidas/renombradas tras importar | Media | Re-localización por pHash+nombre con revisión manual de ambigüedades |
| Consumo de créditos IA (Fase 4) | Segura | Aislado a album-engine; visible en AlbumAIJob; modo manual no gasta |
| Scope creep del editor | Media | Fase 2 = lista cerrada de §9; lo demás espera |
| Dependencias existentes | — | Ninguna: ni una entidad, función, motor o plugin actual se modifica |

---

# 12. PLAN TÉCNICO EXACTO — FASE 2: PROTOTIPO DEL EDITOR MANUAL (sin IA)

Alcance: crear álbum → importar carpeta → editor de spreads completo (§9, puntos 1–7)
con catálogo inicial de layouts → guardado en BD + export/import `.editflowalbum`.

### Archivos NUEVOS (ninguno toca los existentes)
1. `base44/entities/AlbumProject.jsonc`, `AlbumPhoto.jsonc`, `AlbumSpread.jsonc` (RLS
   `created_by_id`; creación solo desde el módulo album).
2. `src/modules/album/lib/albumUnits.js` — mm/px/DPI/presets/validación.
3. `src/modules/album/layout/layoutCatalog.js` — 10 layouts v1 (datos).
4. `src/modules/album/layout/layoutEngine.js` — validate/apply/compatibleLayouts.
5. `src/modules/album/format/albumFile.js` — serialize/parse `.editflowalbum` v1.
6. `src/modules/album/import/folderImport.js` — FSA API + previews IndexedDB + phash.
7. `src/modules/album/manager/albumStore.js` — estado documento + undo/redo + autosave.
8. `src/modules/album/pages/AlbumsPage.jsx` — lista + crear (wireframe B) + import (C).
9. `src/modules/album/pages/AlbumEditorPage.jsx` — shell 3 paneles (E) + overview (D).
10. Componentes del editor: `SpreadCanvas.jsx`, `SlotFrame.jsx`, `PhotoPanel.jsx`,
    `LayoutPanel.jsx`, `SpreadToolbar.jsx`, `AlbumOverview.jsx`.
11. `src/modules/album/hooks/useAlbumProject.js` — CRUD contra entidades `Album*`.

### Archivos EXISTENTES con modificación mínima (los ÚNICOS dos)
| Archivo | Cambio | Por qué | Riesgo | Rollback |
|---|---|---|---|---|
| `src/App.jsx` | +1 import, +1 `<Route path="/album" …>` dentro de las protegidas | Sin ruta, la página es inaccesible | Nulo (aditivo) | Borrar las 2 líneas |
| `src/pages/Hub.jsx` | +1 objeto en array `tools` | Punto de descubrimiento de la herramienta | Nulo (aditivo) | Borrar 1 objeto |

Nada más. Ni `editflow-engine`, ni plugin, ni `rawAi*`, ni entidades existentes.

### Orden exacto de implementación
1. Entidades `Album*` (jsonc) → 2. `albumUnits` + `layoutCatalog` + `layoutEngine`
(fundación, testeable sin UI) → 3. `albumFile` (formato v1) → 4. `folderImport` →
5. `albumStore` → 6. `AlbumsPage` (crear + importar) → 7. `SpreadCanvas`/`SlotFrame`
(interacción por slot) → 8. `PhotoPanel`/`LayoutPanel`/`SpreadToolbar` →
9. `AlbumEditorPage` (integración) + `AlbumOverview` → 10. App.jsx + Hub.jsx (último,
para que la ruta solo exista cuando todo está verificado) → 11. QA del flujo completo
manual + export/import de un `.editflowalbum` de prueba.

Criterio de éxito de Fase 2: crear un álbum 30×30, importar una carpeta de ~100 JPEG,
maquetar 5 spreads con layouts distintos, recortar/redimensionar, reordenar, deshacer,
guardar, reabrir, y exportar/importar el proyecto — todo sin IA y sin tocar nada existente.

---

**FIN DE FASE 1.** Sin implementar código. En espera de aprobación explícita para Fase 2.