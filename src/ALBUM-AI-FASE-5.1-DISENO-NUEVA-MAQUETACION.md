# EDITFLOW ALBUM AI — FASE 5.1: DISEÑO DEL NUEVO SISTEMA PROFESIONAL DE MAQUETACIÓN
Fecha: 2026-09-03 · Fase exclusivamente de DISEÑO. Cero código modificado, cero
entidades tocadas. Basado en la implementación REAL verificada en la Fase 5.0
(`src/ALBUM-AI-FASE-5.0-AUDITORIA-MAQUETACION.md`) y en la lectura directa de
`layoutCatalog.js`, `layoutEngine.js`, `albumStore.js`, `SlotFrame.jsx`,
`SpreadCanvas.jsx`, `PhotoPanel.jsx`, `AlbumOverview.jsx`, `AlbumEditorPage.jsx`,
`albumFile.js`, `previewStore/Service/Lru`, `usePhotoPreview.js` y entidades Album.

---

## 1. RESUMEN EJECUTIVO

Se transforma la experiencia de maquetación de Album AI en un editor profesional de
escritorio, **reconstruyendo la cáscara de UI y los paneles, y conservando intactas las
tres decisiones de arquitectura que ya son correctas**:

1. **Geometría resuelta en `slots`** (el álbum no depende del catálogo de plantillas).
2. **Transformaciones virtuales no destructivas** (`transform` en mm; jamás se toca el original).
3. **Plantillas como DATOS con expresiones** (`evalExpr` resuelve coordenadas sobre
   variables del álbum → el mismo layout sirve para cualquier tamaño).

Veredicto de diseño: el MOTOR no se reconstruye — se EXTENDE con (a) metadatos de
catálogo v3 (categorías/favoritos/densidades), (b) un algoritmo de **reflow
conservador** al cambiar de plantilla y (c) un módulo **autolayout por reglas**.
La INTERFAZ sí se reconstruye: nueva shell de 3 columnas + topbar + navegador inferior,
con identidad propia de EditFlow (tipografía Bebas Neue/Manrope, paleta monocroma
existente del design system).

Sin cambios de esquema obligatorios: todo el diseño es realizable con las entidades
actuales. Los dos cambios aditivos OPCIONALES (props de diseño de spread, favoritos
sincronizados entre dispositivos) quedan documentados y REQUIEREN tu aprobación expresa
antes de implementarse; el diseño funciona sin ellos (favoritos en localStorage).

---

## 2. ARQUITECTURA ACTUAL QUE SE CONSERVA (verificada en auditoría)

| Pieza | Papel en el nuevo diseño |
|---|---|
| Entidades `AlbumProject/AlbumPhoto/AlbumSpread` | Intactas. `slots` con geometría mm + `transform` sigue siendo la fuente de verdad. |
| `albumStore.js` (autosave dirty-queue 700 ms, tmp→real remap, undo/redo 50, retry) | Intacto; solo se le AÑADEN operaciones (reflow). La nueva UI llama a los mismos métodos. |
| `layoutEngine.evalExpr/resolveSlots` | Intactos: el corazón data-driven que permite 1.000 plantillas sin tocar motor. |
| `previewStore/previewService/previewLru` (thumb 256 / preview 1000, LRU 48) | Intactos; dan miniaturas reales al navegador de spreads y al navegador de fotos. |
| `usePhotoPreview.js` | Intacto (crop y canvas lo siguen usando). |
| Importación + identidad (SHA-256, pHash, dedup) + relocalización + missing/unlinked | Intactos y sin cambios de flujo. |
| `albumFile.js` v1/v2 | Intacto; export/import idénticos. |
| Drag & drop base (`text/album-photo`, `text/album-slot`) | Se conserva el protocolo y se extiende (§9). |
| Guías (sangrado/márgenes/seguridad/gutter), bloqueo de spread, fill/fit | Intactos. |
| Fase 4.1 (Selección IA), Lightroom, Core, proveedores | Intocados (fuera de alcance). |

---

## 3. NUEVA ARQUITECTURA PROPUESTA

```text
AlbumEditorPage.jsx  (orquestador fino: carga de datos + importación + relocalización)
        │  reutiliza: useAlbumProject, folderImport, previewStore, albumStore (intactos)
        ▼
EditorShell.jsx  ← NUEVO contenedor profesional (layout fijo de zonas)
   ├── TopBar.jsx                  (proyecto, guardado, undo/redo, métricas, zoom, vista previa, export)
   ├── TemplateLibrary.jsx  IZQ   (catálogo v3: categorías, favoritos, miniaturas vivas)
   ├── ┌ SpreadNavigator.jsx       (tira superior del centro: miniaturas REALES)
   │   ├ SpreadCanvas.jsx         (lienzo — conservado, zoom mejorado)
   │   └ SpreadToolbox.jsx         (herramientas del spread + leftovers + autocolocar)
   │   └ CropOverlay.jsx          (modo edición por doble clic, dentro del lienzo)
   ├── PhotoBrowser.jsx      ABAJO (pestañas, filtros, multi-selección, badges "usada")
   └── PropertiesPanel.jsx   DER   (contextual: álbum/spread o frame/foto)
   └── autolayout.js          (PURO: reglas de puntuación; sin IA, sin red, sin backend)
```

Principios:
- **La lógica no se mueve**: `albumStore` sigue siendo el único dueño del documento de
  spreads; los paneles nuevos son vistas que llaman a sus métodos actuales + 1 nuevo
  (`reflowSpread`).
- **Todo lo visual de plantillas se renderiza desde DATOS** (`TemplateThumb.jsx`):
  miniatura = divs con % de las expresiones resueltas. Cero assets, cero imágenes.
- **Responsive**: en pantallas estrechas (<1024 px) la biblioteca y propiedades pasan a
  paneles deslizables (drawers) y el navegador de fotos colapsa a tira con botón de
  expansión — misma lógica, solo CSS.

---

## 4. DISEÑO COMPLETO DE LA INTERFAZ

### 4.A Barra superior (`TopBar.jsx`)
- Izquierda: nombre del álbum (editable inline), tamaño + unidad, estado
  (`Guardado…/Guardado/Error→Reintentar` reutilizando `store.saving/saveError`).
- Centro: métricas en vivo derivadas en cliente:
  `{spreads.length} pliegos · {spreads.length*2} páginas · {usadas}/{photos.length} imágenes`
  ("usadas" = nº de photo_id distintos presentes en todos los slots).
- Derecha: Undo, Redo (icons + tooltips), zoom con presets
  (Ajustar | 25 | 50 | 75 | 100 | 200 %), **Vista previa** (modal a pantalla completa
  del spread actual con sombreado de página y paginación ←/→; solo lectura), y
  **Exportar** (`.editflowalbum` existente; futuro PDF queda fuera de alcance).

### 4.B Distribución final (decisión técnica)
Tras estudiar el flujo (plantilla→spread→fotos→ajuste), el navegador de spreads va
**en la tira superior de la columna central**, no arriba del todo: mantiene el
contexto del álbum pegado al lienzo y libera el topbar para métricas globales. El
navegador de fotos ocupa **toda la anchura inferior** (como pide la referencia),
maximizando miniaturas. Biblioteca a la izquierda, propiedades a la derecha.

### 4.C Estados vacíos y carga
- Sin spreads: lienzo muestra CTA "Crea tu primer pliego" + botón Autocolocar guiado.
- Sin fotos: navegador inferior invita a importar (mismo flujo actual, sin cambios).
- Foto missing/unlinked: misma representación actual (marco + icono + texto),
  conservando geometría del hueco (requisito Fase 3.1).

---

## 5. BIBLIOTECA DE PLANTILLAS (`TemplateLibrary.jsx` + catálogo v3)

- **Organización**: `FAVORITOS · 1 FOTO · 2 · 3 · 4 · 5 · 6 · 7+` (chips
  horizontales). La categoría se DERIVA de `slot_count` — cero duplicación de datos.
- **Miniaturas**: cada tarjeta renderiza la plantilla a escala (aspect del álbum real)
  con `TemplateThumb.jsx` (divs posicionados por %; el hueco `role:"hero"` se sombrea
  más). Estado activo = plantilla actual del spread. Hover = ligero realce.
- **Favoritos**: corazón en cada tarjeta; persistidos en `localStorage`
  (`editflow-album-fav-templates`). SIN entidad nueva; si más adelante quieres
  sincronizarlos entre dispositivos → cambio aditivo opcional (§16) con tu aprobación.
- **Aplicar**: un clic (sin diálogo). Feedback inmediato en lienzo + entrada de undo.
- **Densidades incompatibles**: las plantillas cuyo `min/max_photos` no admita las
  fotos actuales del spread NO se ocultan — se muestran atenuadas y aplicables
  (reflow gestiona sobrantes/huecos). Explorar es más importante que filtrar.
- **Categorías futuras** (clásico/editorial/moderno/minimal/boda…): campo `family`
  ya existe en el catálogo actual; el chip de estilos aparece cuando existan ≥2
  familias con volumen. La UI de categorías es un filtro plano: añadir datos basta.

## 6. MOTOR DE LAYOUTS — ¿CÓMO TENER 1.000 PLANTILLAS SIN TOCAR EL MOTOR?

Respuesta de diseño: **el motor ya es el correcto; el catálogo es el que crece.**

```js
// FORMATO v3 DE CATÁLOGO (extensión ADITIVA del objeto actual L001–L007)
{
  id: "L123",                    // estable, se persista en spread.layout_id
  name: "3 fotos · escalonado",
  family: "editorial",           // clásico | editorial | modern | minimal | …
  mode: "spread",
  min_photos: 3, max_photos: 3,  // densidad (define la categoría de la UI)
  orientations: ["landscape"],   // del ÁLBBUM (compatibleLayouts actual)
  slot_orientations: ["portrait","landscape","landscape"], // NUEVO: orientación
                                 // PREFERIDA por hueco (usa autolayout + reflow)
  tags: ["full-bleed","horizontal"],
  slots: [ /* expresiones actuales: x,y,w,h + role */ ]
}
```

- **Reglas de escala**: (1) añadir layouts = añadir objetos; (2) prohibido un
  componente por plantilla; (3) prohibida geometría fuera de expresiones;
  (4) `TemplateThumb` lee los mismos datos → miniatura automática para todo el catálogo.
- **Estrategia de volumen (Fase 5.3)**: generador de plantillas por compositores
  paramétricos (cuadrículas n×m, filas/columnas, hero+laterales, mosaicos) que EMITE
  objetos v3 al catálogo en commits de datos (bloques de 30–50 por iteración). El
  generador es un script de datos, no motor: 500 plantillas = 500 filas de datos.
- **L001–L007**: se conservan con su `id` exacto, migradas a v3 (campos nuevos
  con defaults). Los spreads existentes que las referencian siguen intactos.
- `compatibleLayouts` se mantiene (orientación del álbum); el filtro por densidad
  pasa a ser responsabilidad de la UI (chips), no del motor.

## 7. NAVEGADOR DE SPREADS (`SpreadNavigator.jsx`)

- Miniaturas **REALES**: reemplaza los rectángulos esquemáticos actuales. Render: el
  mismo `TemplateThumb`-renderer aplicado al spread (posición % de cada slot) + fondo
  del thumb de la foto del hueco (`thumbs` Map ya cargado en memoria — sin cargas nuevas).
  Aspect proporcional al álbum; alto de tira ~72 px; nº de pliego debajo.
- Interacciones: clic = seleccionar (mismo `store.selectSpread`); drag & drop =
  reordenar (reutiliza `store.reorderSpreads`); hover = acciones flotantes duplicar/
  eliminar; botón "+" al final = añadir. Bloqueo mostrado con candado.
- Rendimiento: virtualización simple por ventana (solo se montan las miniaturas
  visibles ± margen) para álbumes de 40+ pliegos.
- Los botones Anterior/Siguiente se ELIMINAN como navegación principal (permanecen
  teclas ←/→ como atajo).

## 8. NAVEGADOR DE FOTOGRAFÍAS (`PhotoBrowser.jsx`, ancho completo inferior)

- **Pestañas**: `IMÁGENES · FAVORITAS · SIN USAR` + chips de filtro cruzado:
  `Todas / Usadas / Sin usar / Seleccionadas` y orden por `Nombre / Fecha de captura`.
  "Usada" se calcula EN CLIENTE del documento de spreads (Set de photo_id) — sin
  persistir nada nuevo y sin tocar entidades.
- **Grid**: miniaturas con **aspect original** (no recortadas), tamaño configurable
  (control de densidad), badge `✓ UTILIZADA` en esquina (nunca desaparecen), borde de
  selección para multi-selección (Shift/Ctrl + arrastre de marco).
- **Estrella de favoritas**: campo nuevo EN CLIENTE (localStorage keyed por photo_id)
  — opcionalmente migrable a campo aditivo `favorite` de AlbumPhoto con tu aprobación.
- **Drag**: una foto o la selección múltiple arrastrable al lienzo (payload extendido,
  §9). Doble clic mantiene el comportamiento actual (asignar al primer hueco vacío).
- Búsqueda por nombre conservada; flujos de importación/relocalización SIN CAMBIOS
  (mismos handlers actuales, re-ubicados en la cabecera del navegador).

---

## 9. DRAG & DROP — COMPORTAMIENTO Y ARQUITECTURA (diseño, sin implementar)

Protocolo DataTransfer (extensión del actual, retrocompatible):

| Payload | Origen | Destino | Efecto |
|---|---|---|---|
| `text/album-photo` (id) | navegador de fotos | hueco vacío | asigna foto (transform fresh) |
| `text/album-photo` (id) | navegador de fotos | hueco OCUPADO | **REEMPLAZA**: la saliente vuelve automáticamente al navegador (ya es así hoy: nunca se elimina del álbum) — se añade animación de retorno + toast "La foto X vuelve al navegador" |
| `text/album-photo-set` (JSON ids) | multi-selección navegador | lienzo | **Autocolocar directo**: lanza el motor de reglas con esa selección y muestra opciones A–D en el toolbox (§12) |
| `text/album-slot` (slot_id) | grip de un hueco | otro hueco | **INTERCAMBIO** A↔B (existe hoy: `movePhotoBetweenSlots`) |
| `text/album-slot` | grip | navegador de fotos (drop-zone) | **QUITAR del spread**: foto vuelve a estado "sin usar" (nada se borra) — NUEVO |

- Feedback visual de drop: outline azul al arrastrar sobre destino válido; X roja
  en inválido. Un solo origen de verdad: `SlotFrame.onDrop` actual, extendido.
- Arquitectura: cero cambios de esquema; todo son handlers del `albumStore` (el nuevo
  `removePhotoFromSlot` ya existe; solo se expone como drop-zone).

## 10. CAMBIO DE PLANTILLA — REFLOW INTELIGENTE (núcleo de la fase)

Nueva operación única del store: `reflowSpread(spreadId, layoutId)` — UNA entrada de
undo (atomicidad garantizada por el `apply(history=true)` existente).

```text
ENTRADA: spread actual (slots: photo_id+transform+fit) + plantilla destino
1. RESOLVER geometría nueva (resolveSlots — sin cambios).
2. FOTOS ACTUALES → lista ordenada por área de hueco DESC (grandes primero).
3. HUECOS NUEVOS → ordenados por área DESC.
4. EMPAREJAR greedy por orden (con preferencia slot_orientations cuando exista:
   foto portrait → hueco portrait si es posible, si no el siguiente libre).
5. POR CADA PAR (foto, hueco nuevo):
   - Δ_aspect = |aspect_hueco_nuevo / aspect_hueco_viejo - 1|
   - si Δ_aspect < 0.10 → CONSERVAR CROP: transform escala por ratio de anchos
     (scale' = scale · w_viejo/w_nuevo; offsets re-proporcionados y clampeados
     para que el contenido siga cubriendo el hueco en modo fill).
   - si Δ_aspect ≥ 0.10 o el clamping excede límites → RESET (freshTransform).
     Regla: nunca un crop "mentiroso": si no se puede conservar con garantía,
     se reinicia y se marca el hueco con punto de atención en la UI.
6. SI AUMENTA el nº de huecos → fotos actuales en los primeros huecos emparejados,
   resto VACÍOS (listos para drop).
7. SI DISMINUYE → emparejar las que mejor encajen; las SOBRANTES van al panel
   LEFTOVERS del toolbox (chips con thumb + botón "arrastrar a otro pliego" y
   "quitar"). NUNCA se eliminan del álbum; quedan VISIBLES para decisión del usuario.
8. fit_mode: se conserva por foto cuando Δ_aspect < 0.10.
```

- **Rollback**: una entrada de undo → `Ctrl+Z` devuelve spread, fotos y crops exactos
  (el snapshot JSON del store ya lo garantiza).
- Interacción: aplicar plantilla no limpia la selección de spread; el panel de
  leftovers permanece hasta que el usuario lo cierre o quede vacío.

## 11. EDITOR DE FRAMES Y CROP (`CropOverlay.jsx`, doble clic)

- **Entrada**: doble clic sobre una foto del lienzo → overlay de edición DENTRO del
  marco del hueco (no modal global): la foto pasa a resolución preview (1000 px vía
  `usePhotoPreview`, ya existente), marco con retícula de tercios y manejes.
- **Controles** (barra flotante del overlay): Zoom (slider 30–400 % + rueda), Pan
  (arrastrar, ya implementado hoy vía `onPan`), **Fill** (recortar a marco, fit fill),
  **Fit** (contener), **Centrar** (freshTransform), **Rotar ±90°** (escribe
  `transform.rotation` — campo ya persistido desde Fase 1, hoy sin UI; se decide
  SÍ exponerla: es no destructiva y el motor de render la soporta con un
  `rotate()` en el transform CSS del SlotFrame).
- **Salida**: clic fuera / Esc / botón Listo. Una sola entrada de undo por sesión de
  crop (`gestureBegin` al abrir el overlay, `apply` al cerrar) — hereda el patrón de
  gestura existente.
- **NO DESTRUCTIVO**: solo escribe `transform` (mm) en `AlbumSpread.slots` — el mismo
  contrato de datos actual. JPEG/RAW jamás se tocan.
- Para huecos VACÍOS el doble clic no abre overlay (placeholder invita a soltar foto).

## 12. AUTOCOLOCAR SIN IA (`layout/autolayout.js`)

Módulo PURO de funciones sin estado, sin red, sin backend, sin tocar `album-engine`
(prohibido por diseño mezclarlo con la IA de Fase 4.1 o cualquier futura IA):

```text
SELECCIÓN (n fotos: orientations + width_px/height_px)
   ↓ scoreTemplates(photos, album, {favorites})
1. FILTRO DURO: min_photos ≤ n ≤ max_photos (o n ≥ max si acepta recortes marcados)
2. PUNTUACIÓN (0–100):
   +30 densidad exacta de huecos == n
   +25 por foto emparejada con slot_orientation preferida (greedy)
   +15 similitud de aspecto medio foto vs medio hueco (distancia log-aspecto)
   +10 family == style_hint del álbum
   +10 plantilla en favoritos del usuario
   −15 si sobran fotos (n > max_photos)
   ↓
3. TOP 4 OPCIONES → tarjetas con miniatura real (datos) + nº de fotos encajadas
   + "sobran X" si aplica
   ↓
4. EL FOTÓGRAFO ELIGE (clic) → reflowSpread(spreadId, layoutId) con esas fotos
   en el ORDEN de selección del usuario (temporal → narrativo)
```

- Orquestado desde el `SpreadToolbox` (botón "Autocolocar" activo con selección ≥ 1)
  y por drop de multi-selección al lienzo (§9).
- Determinista y explicable: cada opción muestra su puntuación resumida en tooltip.

## 13. COMPATIBILIDAD `.editflowalbum` v1 / v2

- **Sin cambios de formato**: v2 actual sigue siendo el máximo; nada del diseño exige
  campos nuevos en el archivo (reflow, autolayout, favoritos y "usada" son estado
  derivado o local). No hay MIGRACIÓN alguna que documentar/implementar.
- **Spreads existentes**: `layout_id` antiguos (L001–L007, "custom") siguen válidos;
  el catálogo v3 conserva esos ids.
- **Transformaciones existentes**: el render actual no cambia de contrato; el reflow
  solo actúa al APLICAR plantilla, nunca al abrir.
- **Fotos missing/unlinked**: representación actual intacta (geometría conservada);
  el navegador de fotos las muestra con su icono y no bloquea autocolocar de otras.
- **Álbumes v1 importados**: flujo actual intacto (sin identidad multicapa → funciona).
- Verificación de regresión obligatoria por fase (§18): abrir álbum pre-5.2 en cada
  checkpoint, exportar v2 e importar v1.

## 14. ARCHIVOS QUE SE MODIFICARÍAN POSTERIORMENTE (todos en `src/modules/album/`)

`pages/AlbumEditorPage.jsx` (composición → shell), `manager/albumStore.js` (+1 método
`reflowSpread`), `layout/layoutCatalog.js` (formato v3 + volumen), `layout/layoutEngine.js`
(+helpers de reflow puros), `editor/SlotFrame.jsx` (doble clic, rotación, feedback drop),
`editor/SpreadCanvas.jsx` (presets zoom + fit real), `editor/AlbumOverview.jsx` →
sustituido por SpreadNavigator, `editor/PhotoPanel.jsx` → sustituido por PhotoBrowser,
`editor/LayoutPanel.jsx` → sustituido (biblioteca + propiedades), `editor/SpreadToolbar.jsx`
→ absorbido. `pages/AlbumApp.jsx` y format/albumFile.js: **sin cambios**.

## 15. ARCHIVOS NUEVOS NECESARIOS

`editor/EditorShell.jsx`, `editor/TopBar.jsx`, `editor/TemplateLibrary.jsx`,
`editor/TemplateThumb.jsx`, `editor/SpreadNavigator.jsx`, `editor/SpreadToolbox.jsx`,
`editor/PhotoBrowser.jsx`, `editor/PropertiesPanel.jsx`, `editor/CropOverlay.jsx`,
`editor/PreviewModal.jsx`, `layout/autolayout.js`, `lib/usedPhotos.js` (derivado
cliente de usadas/favoritos locales). Ninguno fuera del módulo.

## 16. RIESGOS

| Riesgo | Mitigación |
|---|---|
| Reflow pierde/mueve fotos inesperadamente | Reglas §10 + leftovers visibles + undo atómico + atenuación de plantillas incompatibles |
| Rotación CSS distorsiona el clamping de crop | Se libera en 5.6 con límites y pruebas; es el único render-nuevo del diseño |
| Rendimiento tira de spreads con 40+ pliegos | Virtualización por ventana; thumbs ya en memoria |
| Volumen del catálogo degrada la UI | Chips de densidad + ventana virtual en la biblioteca; catálogo cargado una vez |
| Desviación hacia IA | `autolayout.js` puro; `album-engine` no referenciado; revisión en cada checkpoint |
| Cambios aditivos opcionales (favoritos en BD, props de spread) | NO incluidos por defecto; requieren tu aprobación expresa |

## 17. ROLLBACK

- Fase a fase: cada checkpoint deja el editor usable; revertir una fase = restaurar los
  archivos de esa fase (el contrato del store y de datos no cambia → el álbum guardado
  siempre abre con cualquiera de las versiones).
- Rollback total: restaurar composición de `AlbumEditorPage` original; datos 100 %
  compatibles (ningún campo nuevo obligatorio). La Fase 3.1/4.1 jamás se toca.

## 18. PLAN EXACTO DE IMPLEMENTACIÓN POR FASES (con checkpoints)

| Fase | Contenido | CHECKPOINT de prueba |
|---|---|---|
| **5.2** Shell + TopBar + re-composición con motor ACTUAL (LayoutPanel/PhotoPanel/Overview aún vivos dentro del nuevo layout) | Abrir álbum existente · guardar/autosave · undo/redo · zoom presets · abrir álbum v1 |
| **5.3** Catálogo v3 (L001–L007 migrados + primer bloque ~40 plantillas), TemplateLibrary + TemplateThumb, reflowSpread en store | Aplicar plantilla sin perder fotos · leftovers · undo de reflow · layout_id antiguos intactos |
| **5.4** SpreadNavigator con miniaturas reales + virtualización; eliminación de Anterior/Siguiente | Navegar 30+ pliegos fluido · reordenar drag&drop · duplicar/eliminar |
| **5.5** PhotoBrowser (pestañas/filtros/orden/badges/multi-selección) + drag&drop extendido (reemplazo, quitar al navegador, multi→lienzo) | Fotos usadas visibles · reemplazo devuelve foto · quitar no borra nada |
| **5.6** CropOverlay (doble clic) + rotación + SpreadToolbox completo + PreviewModal | Crop no destructivo (verificar XMP-nada-tocado) · una entrada de undo por sesión |
| **5.7** Autolayout por reglas + integración final de flujo (selección→opciones A–D) | Autocolocar determinista · sin llamadas de red · resultados explicables |

Después de cada checkpoint: informe breve + espera de tu aprobación. Ninguna fase
toca nada fuera de `src/modules/album/`.

---

# FIN DE FASE 5.1 — SOLO DISEÑO. CERO CÓDIGO MODIFICADO.
# DETENIDO. ESPERANDO TU APROBACIÓN PARA INICIAR FASE 5.2.