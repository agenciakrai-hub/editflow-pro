# EDITFLOW ALBUM AI — FASE 5.0: AUDITORÍA REAL DEL SISTEMA ACTUAL DE MAQUETACIÓN
Fecha: 2026-09-03 · Auditoría SIN código: solo lectura de la implementación real de
`src/modules/album/` y de las entidades Album. Nada se ha modificado.

---

## 1. QUÉ EXISTE ACTUALMENTE (mapa real, verificado archivo a archivo)

### Modelo de datos (entidades Album, RLS por usuario)
- **AlbumProject**: dimensiones canónicas en mm, presets de tamaño, bleed/margin/gutter,
  `spread_count_target`, `max_photos_per_spread`, `style_hint`, `display_unit` (cm/mm),
  `doc_version` (v1/v2).
- **AlbumPhoto**: filename, relative_path, orientation (derivada), capture_time,
  `preview_status` (ok/missing/unlinked), identidad multicapa Fase 3.1
  (file_size, content_hash SHA-256, pHash, width/height_px), campos IA
  (ai_state, ai_override, ai_rank, ai_scores, ai_category).
- **AlbumSpread**: `order_index`, `mode` (spread / page_left / page_right),
  `layout_id` (catálogo o "custom"), `locked`, `ai_generated` (reserva) y **slots con
  geometría RESUELTA en mm** + `fit_mode` (fill/fit) + `z_index` + **transform virtual**
  (scale, offset_x/y_mm, rotation, crop) — no destructivo.

### Editor actual (`pages/AlbumEditorPage.jsx`)
Estructura vertical: cabecera (nombre, estado guardado, undo/redo, zoom %, export,
Selección IA) → barra de guías → **AlbumOverview** (tira horizontal de spreads) → fila:
**PhotoPanel** (izquierda, 224 px) | **SpreadToolbar + SpreadCanvas** (centro) |
**LayoutPanel** (derecha, 256 px).

### Motor de plantillas (`layout/layoutCatalog.js` + `layoutEngine.js`)
- **7 layouts (L001–L007)** definidos como DATOS (no componentes), con coordenadas
  como **expresiones** sobre variables del álbum (`W, H, margin, gutter, bleed,
  page_w, page_h`) resueltas por un mini-evaluador. Cualquier layout sirve para
  cualquier tamaño de álbum.
- `applyLayout(spread, layout, album)` resuelve la geometría a mm y la **conserva en
  el spread** (el álbum nunca depende del catálogo).
- `compatibleLayouts()` filtra por orientación del álbum y nº de fotos del spread.
- `makeCustomSlot()` para huecos libres.

### Estado (`manager/albumStore.js`)
- Undo/redo (historial de 50 snapshots de spreads), autosave **debounce 700 ms** con
  cola dirty por spread, ids temporales `tmp_` remapeados al persistir, banner de error
  + reintentar, selección de spread/slot, reordenar (drag o flechas), duplicar,
  bloquear, asignar/quitar foto, intercambiar entre huecos, hueco libre.

### Interacción (`editor/SlotFrame.jsx`, `SpreadCanvas.jsx`)
- Drag foto del panel → hueco (asigna), drop sobre lienzo vacío → hueco libre centrado,
  grip arrastrable → intercambio entre huecos, pan sobre la foto = **crop virtual**,
  rueda = zoom de foto, mover/redimensionar hueco, guías de sangrado/márgenes/zona
  segura/gutter, zoom del lienzo ±25 % y "Ajustar".

### Fotos (`editor/PhotoPanel.jsx`, previews Fase 3.1)
- Importación carpeta (File System Access) / archivos sueltos, dedup por nombre Y
  content_hash, previews de 2 niveles (thumb 256 + preview 1000 con **LRU RAM máx 48**),
  búsqueda por nombre, doble clic = asignar al primer hueco vacío, relocalización
  (RelocateDialog) con confirmación visual.

### Formato (`format/albumFile.js`)
- Export/import `.editflowalbum` **v1 y v2** (v2 aditivo: identidad por foto).
  El importador acepta ambas; remapea photo_id; previews no viajan (missing → re-import).

---

## 2. QUÉ FUNCIONA CORRECTAMENTE — CLASIFICACIÓN: **CONSERVAR**

| Componente | Veredicto | Motivo |
|---|---|---|
| Modelo de datos (slots con geometría resuelta + transform virtual) | **CONSERVAR** | Es la decisión de arquitectura más valiosa: álbum independiente del catálogo y no destructivo. Base perfecta para todo el rediseño. |
| `albumStore` (autosave con cola dirty, tmp→real, undo/redo, error+retry) | **CONSERVAR** | Robusto, probado; el rediseño de UI NO debe tocarlo salvo operaciones aditivas. |
| Importación + identidad (SHA-256, pHash, dedup, relocalización, missing/unlinked) | **CONSERVAR**** (Fase 3.1 íntegra)** | Requisito explícito de protección. |
| Previews de 2 niveles + LRU | **CONSERVAR** | Da servicio tanto al navegador de fotos como a miniaturas reales de spreads (hoy infrautilizado). |
| `albumFile.js` v1/v2 | **CONSERVAR** | Compatibilidad obligatoria. |
| Motor de expresiones (`evalExpr`/`resolveSlots`) | **CONSERVAR** (extender) | Escala a cientos de layouts sin tocar el motor: exactamente la base data-driven pedida. |
| Drag & drop foto→hueco, intercambio hueco↔hueco, hueco libre | **CONSERVAR** | Semántica ya correcta (la foto sustituida nunca se elimina del álbum). |
| Guías (sangrado/márgenes/seguridad/gutter) | **CONSERVAR** | Ya implementadas y configurables. |
| Bloqueo de spread, fit fill/fit, zoom de foto, crop por pan+rueda | **CONSERVAR** (mejorar UX) | Funcional; falta modo crop explícito y rotación con UI. |

---

## 3. QUÉ LIMITA LA NUEVA EXPERIENCIA — CLASIFICACIÓN: MEJORAR / SUSTITUIR

| # | Componente actual | Limitación real (verificada) | Clasificación |
|---|---|---|---|
| 1 | `layoutCatalog.js` | Solo **7 layouts**. Sin categoría por nº de fotos, sin familias navegables, sin favoritos, sin miniaturas. La estructura soporta N layouts, pero faltan metadatos y volumen. | **MEJORAR** (extender formato del catálogo; el motor no cambia) |
| 2 | `LayoutPanel.jsx` | Los layouts se eligen de una **lista de texto** filtrada SOLO por el nº de fotos actual → imposible explorar plantillas de otra densidad ni previsualizarlas. Mezcla plantillas y propiedades de hueco en un panel. | **SUSTITUIR** (nueva biblioteca visual + panel de propiedades separado) |
| 3 | `applyLayout()` (layoutEngine) | Al cambiar plantilla conserva las fotos **por orden** pero: si el nº de slots baja, las fotos sobrantes **desaparecen del spread en silencio** (no se eliminan del álbum, pero el usuario no decide), y **resetea los crops** (freshTransform) siempre. | **MEJORAR** (reflow inteligente + leftovers visibles) |
| 4 | `AlbumOverview.jsx` | Miniaturas **esquemáticas** (rectángulos de color, sin fotos reales), 96 px, sin nº de página, sin modo páginas. Es la única vista global. | **SUSTITUIR** (navegador visual con miniaturas reales usando thumbs ya en memoria) |
| 5 | `SpreadToolbar.jsx` | Navegación principal por botones Anterior/Siguiente — justo lo que NO se quiere como sistema principal. | **SUSTITUIR** (integrar en navegador visual) |
| 6 | Composición de `AlbumEditorPage.jsx` | Distribución vertical/no profesional: fotos a la IZQUIERDA (objetivo: abajo), plantillas y propiedades mezcladas a la derecha (objetivo: plantillas izquierda, propiedades derecha), sin barra superior con métricas (pliegos/páginas/fotos usadas/disponibles). | **SUSTITUIR** (shell profesional 3 columnas + topbar; reutilizando store y canvas) |
| 7 | `PhotoPanel.jsx` | Sin pestañas (todas/favoritas/sin usar), sin indicador de "usada", sin selección múltiple, sin ordenar, sin filtros por estado, miniaturas cuadradas recortadas. | **SUSTITUIR** (navegador profesional abajo) |
| 8 | `SlotFrame.jsx` | Sin **modo crop por doble clic**, sin rotación con UI (rotation se guarda pero no hay control), sin affordances claras de reemplazo, sin fit/fill/centrar en la barra. | **MEJORAR** (conservando transform virtual) |
| 9 | Zoom del lienzo | Pasos ±25 % sin presets (25/50/75/100/200) ni fit-to-screen real al redimensionar. | **MEJORAR** |
| 10 | Autocolocar | **No existe** ningún motor de sugerencia por reglas. | **NUEVO** (Fase 5.5, separado de la IA) |
| 11 | Propiedades de spread (fondo, bordes, esquinas, separación) | `AlbumSpread` **no tiene campos** para diseño de página. | **NUEVO** (campos aditivos, con aprobación) |
| 12 | Favoritos de plantillas | No existe persistencia de favoritos por usuario. | **NUEVO** (local o campo aditivo, con aprobación) |

---

## 4. QUÉ SE PUEDE REUTILIZAR TAL CUAL

- **Todo el bloque CONSERVAR de la sección 2** — es el 70 % del sistema y es sólido.
- `usePhotoPreview`/`previewService`/`previewLru`: dan miniaturas reales para el
  navegador de spreads y para las miniaturas de plantillas aplicadas sin código nuevo.
- `useAlbumProject` (CRUD hooks): sin cambios.
- El sistema de expresiones: una biblioteca de 200 layouts son 200 objetos de datos;
  el motor actual los resuelve sin modificar una línea.
- El `slotHandlers` de `AlbumEditorPage` + gesturas de `SlotFrame`: la nueva UI solo
  re-encamina los mismos handlers.

## 5. QUÉ DEBE RECONSTRUIRSE (interno, sin crear herramienta nueva)

1. **Shell del editor** (composición de `AlbumEditorPage.jsx`): topbar de proyecto +
   3 columnas (plantillas | lienzo+spreads+fotos | propiedades). Reutiliza store,
   canvas y datos; cambia la composición y los paneles.
2. **Biblioteca de plantillas** (sustituye la lista de `LayoutPanel`): miniaturas
   visuales renderizadas desde los DATOS del layout (no imágenes), agrupadas
   (Favoritos / 1 / 2 / 3 / 4 / 5 / 6 / 7+ fotos), buscadoras, con vista previa
   aplicada al spread actual.
3. **Reflow de plantilla** (extensión de `applyLayout`): mantener fotos → reasignar
   por mejor ajuste (orientación/área) → conservar/ajustar crops → leftovers visibles
   para decisión del usuario → jamás eliminar fotos del álbum.
4. **Navegador de spreads** (sustituye `AlbumOverview`): miniaturas REALES con thumbs,
   nº de pliego/página, drag & drop, añadir/duplicar/eliminar, selección.
5. **Navegador de fotos inferior** (sustituye `PhotoPanel` en esa posición): pestañas,
   filtros (todas/usadas/sin usar/favoritas/seleccionadas), selección múltiple,
   badge "✓ utilizada", ordenar, búsqueda.
6. **Modo crop profesional** en `SlotFrame` (doble clic): overlay con zoom/pan/fit/
   fill/centrar — sobre el MISMO transform virtual actual.
7. **Autocolocar por reglas** (nuevo módulo `layout/autolayout.js`): dado un conjunto
   de fotos → puntuar plantillas por nº, orientaciones y aspectos → ofrecer opciones
   A/B/C/D. Separado por diseño de cualquier IA futura.
8. **Barra de herramientas del spread** (nueva, bajo el lienzo): frame/foto/diseño
   según especificación del usuario.

## 6. COMPATIBILIDAD CON ÁLBUMES EXISTENTES

- **Garantía estructural**: la geometría resuelta en `slots` es la fuente de verdad; el
  catálogo solo se consulta al APLICAR una plantilla. Cualquier álbum actual abre y
  edita aunque se sustituya toda la biblioteca.
- **v1/v2**: `albumFile.js` no se toca en su lógica de versiones; los formatos siguen
  exportándose/importándose idénticos (los posibles campos nuevos de spread serían
  opcionales → v2 los ignora si no existen; ninguna migración forzada).
- **L001–L007**: se conservan con el mismo `id` (compatibilidad con `layout_id`
  almacenado) y se migran al nuevo formato de metadatos (categoría, etiquetas).
- **Riesgo controlado**: los únicos cambios de esquema posibles (campos de diseño de
  spread, favoritos) serían ADITIVOS y con tu aprobación previa — se documentarán en 5.1.

## 7. LISTA EXACTA DE ARCHIVOS QUE SERÍAN MODIFICADOS (todas dentro de `src/modules/album/`)

**Modificados:** `pages/AlbumEditorPage.jsx` (composición), `pages/AlbumApp.jsx` (solo
si se añade vista), `editor/AlbumOverview.jsx` → navegador visual, `editor/PhotoPanel.jsx`
→ navegador inferior, `editor/LayoutPanel.jsx` → dividido en biblioteca + propiedades,
`editor/SlotFrame.jsx` (modo crop/rotación), `editor/SpreadCanvas.jsx` (zoom presets/fit),
`editor/SpreadToolbar.jsx` (absorbido), `layout/layoutCatalog.js` (formato extendido +
volumen), `layout/layoutEngine.js` (reflow conservador), `manager/albumStore.js`
(operaciones aditivas: reflow, props de diseño si se aprueban).

**Nuevos (propuestos):** `editor/EditorShell.jsx`, `editor/TopBar.jsx`,
`editor/SpreadNavigator.jsx`, `editor/TemplateLibrary.jsx`, `editor/TemplateThumb.jsx`,
`editor/PhotoBrowser.jsx`, `editor/SpreadToolbox.jsx`, `editor/PropertiesPanel.jsx`,
`editor/CropOverlay.jsx`, `layout/autolayout.js`.

**Fuera del módulo: NINGUNO.** Si cualquier necesidad obligara a tocar algo fuera de
`src/modules/album/` (p. ej. `base44/entities/AlbumSpread.jsonc`, que está fuera de la
carpeta src pero ES una entidad Album), me detendré y pediré aprobación con el formato
ARCHIVO / MOTIVO / CAMBIO NECESARIO / RIESGO / ALTERNATIVA. Lightroom, Core,
`editflow-engine`, proveedores IA y Fase 4.1: **intocados**.

## 8. RIESGOS

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Reflow pierde fotos al cambiar plantilla | Alta | Algoritmo conservador + panel de leftovers; nunca se elimina del álbum; undo siempre disponible |
| Regresión en autosave/undo al tocar `albumStore` | Alta | Solo operaciones aditivas; el dirty-queue/undo existente se reutiliza sin reescribir; prueba de regresión por fase |
| Rendimiento del navegador de spreads con miniaturas reales (30+ spreads) | Media | Reutilizar thumbs 256 px ya en memoria + virtualización de tira; el LRU ya limita previews |
| Historial de undo (clone JSON de todos los spreads) con álbumes grandes | Media | Ya existe (límite 50); vigilar tamaño, opcional optimización diferida a 5.4 |
| Cambios de esquema aditivos (diseño de spread/favoritos) | Media | Aditivos y aprobados previamente; v2 los ignora; sin migración |
| Alcance desborda hacia IA | Baja | Autolayout por reglas aislado en módulo propio desde el día 1; prohibido llamar a album-engine |
| Rotura de atajos existentes de importación/relocalización | Baja | Flujos conservados tal cual; solo cambia el contenedor |

## 9. PLAN DETALLADO PARA FASE 5.1 (diseño técnico, aún sin código)

1. **Wireframe de la UI objetivo** (topbar, 3 columnas, toolbox inferior) con
   asignación componente↔archivo y qué reutiliza cada uno (store, canvas, previews).
2. **Formato de catálogo v3**: esquema extendido de plantilla
   (`id, name, category, tags, min_photos, max_photos, orientations, favorite_preset,
   slots[expresiones], preview_hint`) + estrategia de volumen (generación asistida por
   datos de 50→500) + cómo quedan L001–L007 migrados.
3. **Especificación del reflow**: reglas de conservación de fotos, ajuste de crops
   (proporción transform escala/offset al cambiar aspecto del hueco) y panel de leftovers.
4. **Especificación del navegador de fotos**: pestañas/filtros/estados y cómo se
   calcula "usada" (derivado en cliente de los spreads; sin cambios de esquema).
5. **Especificación del modo crop** (doble clic) y de la toolbox del spread.
6. **Especificación de autolayout por reglas** (puntuación de plantillas, opciones A–D,
   módulo aislado) — solo diseño; implementación en 5.5.
7. **Matriz de compatibilidad**: v1/v2, álbumes actuales, L001–L007, flujos Fase 3.1/4.1.
8. **Propuesta de cambios aditivos de esquema** (si se requieren) para aprobación
   EXPRESA antes de implementar.
9. **Plan de pruebas por fase** (abrir álbum existente, navegar, aplicar plantillas,
   reflow con sobrantes, undo/redo, autosave, export v2, import v1).
10. **Checkpoints** al final de 5.1 (diseño) y 5.2 (UI sobre motor actual), como has
    definido.

---

# FIN DE FASE 5.0 — SIN MODIFICAR CÓDIGO. DETENIDO Y ESPERANDO TU APROBACIÓN PARA FASE 5.1.