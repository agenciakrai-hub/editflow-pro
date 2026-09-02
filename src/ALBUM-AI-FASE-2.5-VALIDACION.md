# EDITFLOW ALBUM AI — FASE 2.5: VALIDACIÓN, PRUEBAS Y AUDITORÍA DEL EDITOR MANUAL
Fecha: 2026-09-02 · Sin código modificado, sin funcionalidades añadidas, sin tocar
`editflow-engine`, plugin de Lightroom, IA ni sistemas existentes.

---

# A. RESULTADO GENERAL

# APTO CON OBSERVACIONES

El prototipo es funcional, está aislado y no ha introducido regresiones en EditFlow.
Se detectaron **6 problemas reales (ninguno estructural, ninguno que afecte al core)**,
detallados en la sección D con su solución propuesta. Ninguno fue corregido durante
esta fase, según la regla establecida: se espera decisión del usuario.

---

# B. FUNCIONALIDADES PROBADAS

1. Auditoría estática completa de los 21 archivos nuevos (`src/modules/album/` + 3
   entidades `Album*`): imports, dependencias, código sin utilizar, duplicación,
   fugas de memoria, gestión de previews/permisos, persistencia.
2. Persistencia end-to-end real contra la base de datos (crear → escribir spreads con
   transformaciones → releer como hace el editor → comparar → limpiar).
3. Geometría del motor de layouts replicada exacta y validada sobre los 3 tamaños
   exigidos (30×30, 35×25, 25×35) con los 7 layouts.
4. Unidades (cm/mm), orientación derivada, compatibilidad de layouts por orientación.
5. Solo lectura y no subida de originales (revisión de flujo de importación y de los
   datos que llegan a la base de datos).
6. Formato `.editflowalbum` (export/parse/import: revisión de código + validación del
   remapeo de referencias).
7. Undo/redo y canvas: auditoría de código (no ejecutables de forma automatizada;
   ver Limitaciones).
8. Regresión sobre EditFlow Core y revisión de los cambios en App.jsx y Hub.jsx.

---

# C. PRUEBAS SUPERADAS

## C.1 Persistencia (prueba real en base de datos) — ✅ TODAS
- Config del álbum: 300×300 mm, unidad cm, gutter 6, márgenes 10, sangrado 3 → ✅
- **Orientación NO almacenada** (siempre derivada) → ✅
- Metadatos de fotos: nombre, orientación, capture_time, preview_status → ✅
- Orden de spreads (order_index) → ✅
- layout_id persistido (L002 y custom) → ✅
- Geometría exacta en mm (x/y/w/h de slots) → ✅
- Transformaciones: escala 1.4 / 2.05, offsets negativos y decimales (3.5, −2.25,
  −7.5, 4.25) → ✅ round-trip exacto
- Bloqueo de spread (locked) → ✅
- Referencias slot→AlbumPhoto (photo_id) → ✅
- Limpieza completa de la prueba (sin datos residuales) → ✅

## C.2 Geometría (motor exacto sobre 3 tamaños × 7 layouts) — ✅ TODAS
| Comprobación | 30×30 | 35×25 | 25×35 |
|---|---|---|---|
| Todos los layouts dentro de los límites del spread | ✅ | ✅ | ✅ |
| L001 full-bleed exacto (0,0,W,H) | ✅ | ✅ | ✅ |
| L002: página izquierda termina en page_w; derecha empieza tras gutter y respeta márgenes | ✅ | ✅ | ✅ |
| L004: 4 cuadrantes iguales, sin solape, con gutter | ✅ | ✅ | ✅ |
| L006: 3 columnas con gutter exacto | ✅ | ✅ | ✅ |
| Unidad interna SIEMPRE milímetros (page_w 147/172/122 mm según tamaño) | ✅ | ✅ | ✅ |
- Orientación derivada: 30×30 → cuadrado; 35×25 → horizontal; 25×35 → vertical → ✅
- Conversiones cm↔mm correctas (30 cm = 300 mm; 30 mm = 30 mm) → ✅
- Compatibilidad: L003 y L006 (solo landscape/square) excluidos en álbum vertical → ✅

## C.3 Solo lectura / no destrucción — ✅
- Carpeta abierta con `showDirectoryPicker({ mode: "read" })`; sin escrituras en disco.
- Previews generadas en memoria (canvas) y guardadas SOLO en IndexedDB local.
- A la base de datos solo llegan metadatos (nombre, ruta, orientación, fecha, estado):
  **ninguna imagen se sube ni se almacena en servidor.**
- Ningún flujo escribe en archivos: sin `createWritable`, sin `FileWriter`, sin
  escritura de metadatos.

## C.4 Aislamiento y arquitectura — ✅
- Dependencia unidireccional: nada existente importa nada de `album/`; `album/` no
  importa ningún módulo existente de EditFlow (verificado import a import).
- IndexedDB propio (`editflow-album-db`), separado del de proyectos RAW.
- Historial undo/redo local al hook del editor (refs internas, sin estado global);
  sin ninguna conexión con el editor existente de EditFlow (Ajustes IA).
- Entidades con RLS `created_by_id` en las 4 operaciones, sin relaciones con entidades
  existentes.

## C.5 Regresión — ✅
- Entidades de EditFlow Core (p. ej. Project) operativas tras los cambios.
- `src/App.jsx`: exactamente +1 import y +1 ruta (`/album`, sin colisión con rutas
  existentes). `src/pages/Hub.jsx`: exactamente +1 icono y +1 tarjeta.
  **Rollback = borrar únicamente esas líneas.**
- `editflow-engine`, funciones `rawAi*`, plugin Lua, Cerebro, Selección, XMP y
  proveedores IA: **intactos** (cero modificaciones en esta fase y en la Fase 2).

---

# D. PROBLEMAS DETECTADOS (pendientes de decisión — NO corregidos)

| # | Archivo | Problema | Severidad | Impacto | Solución recomendada |
|---|---|---|---|---|---|
| P1 | `import/folderImport.js` | Re-importar la misma carpeta **no restaura las previews**: `ingestFiles` salta los nombres ya existentes sin generar/cache la preview. En otro dispositivo (o tras importar un `.editflowalbum`) las fotos quedan "preview no disponible" indefinidamente. | **Media-alta** | Solo módulo album; rompe el flujo multi-dispositivo y el post-import del formato | Para nombres existentes: generar y cachear igualmente la preview y actualizar `preview_status`. ~5 líneas, sin tocar nada más |
| P2 | `pages/AlbumEditorPage.jsx` + `editor/SpreadToolbar.jsx` | Los botones "Anterior/Siguiente" ejecutan `moveSpread` (reordenan) en vez de navegar; duplican a "Mover ◀▶". La navegación solo existe clicando miniaturas. | Media | Solo módulo album; riesgo de reordenar sin querer | Cablear onPrev/onNext a seleccionar el spread anterior/siguiente; reordenar queda solo en Mover ◀▶ |
| P3 | `manager/albumStore.js` | Errores de create/update en el autosave se tragan (`catch {}`) y el indicador muestra "Guardado" aunque una escritura falle. | Baja | Solo módulo album; pérdida silenciosa en fallo de red | Exponer estado de error de guardado ("No se pudo guardar") y reintentar |
| P4 | `manager/albumStore.js` | El timer de autosave no se limpia al desmontar el editor (posible flush tras cerrar). | Baja | Inofensivo; puede reescribir un registro tras salir | `clearTimeout` en el cleanup del hook |
| P5 | `editor/SlotFrame.jsx` | Listeners de window durante un gesto se limpian en mouseup; si el hueco se desmonta a mitad de gesto, persisten hasta el siguiente mouseup. | Baja | Fuga puntual y autolimitada | Guardar referencias y limpiar en unmount |
| P6 | `components/AlbumCreateForm.jsx` | Cambiar la unidad (cm↔mm) tras escribir dimensiones reinterpreta el número sin convertir (30 pasa a significar 30 mm). | Baja | Solo formulario de creación | Convertir los valores al cambiar unidad |

**Observaciones (no son defectos, documentadas como comportamiento):**
- Pan del lienzo vía scroll del contenedor (no hay herramienta de mano con arrastre).
- Re-aplicar el layout actual resetea las transformaciones (crops) de los huecos —
  coherente con "cambiar layout", pero conviene saberlo.
- La carga de previews al abrir es secuencial: lenta con cientos de fotos
  (paralelizable en una corrección futura).
- `mmToPx` exportado sin uso actual (quedará para la futura exportación a píxeles).

---

# E. LIMITACIONES ACTUALES

1. **Fotografías locales (crítico entenderlo)**: las previews viven SOLO en el
   IndexedDB del dispositivo que importó la carpeta. En otro dispositivo el álbum
   abre con catálogo y spreads completos pero sin imágenes (placeholders claros).
   La re-importación de la carpeta debería restaurarlas, pero hoy **no lo hace (P1)**.
2. **Relocalización por pHash: NO implementada** (estaba prevista para una fase
   posterior). Consecuencias verificadas por análisis del flujo:
   - **A. Carpeta movida / D. almacenamiento desconectado**: el álbum sigue
     funcionando con las previews cacheadas; sin caché muestra placeholders. No hay
     detección activa de "carpeta desaparecida" (no se re-escanea al abrir).
   - **B. Foto renombrada**: el registro antiguo queda con su nombre previo y su
     preview cacheada sigue funcionando; re-importar crea una entrada nueva (el
     catálogo puede quedar con duplicado lógico). No se re-enlaza por huella.
   - **C. Foto eliminada en disco**: igual que A — el spread y las transformaciones
     se conservan intactos; el archivo original no es necesario para ver/editar el
     diseño (solo lo será para la futura exportación final).
   - **E. Reabrir el álbum**: funciona siempre; los datos del diseño nunca se pierden
     porque no dependen de los archivos, solo de las referencias.
   - En ningún caso se modifican los archivos originales (solo lectura garantizada).
3. **`.editflowalbum`**: NO transporta imágenes (diseño v1). Tras importarlo, las
   fotos quedan "missing" hasta re-importar la carpeta — hoy bloqueado por P1.
   Todo lo demás (spreads, orden, layouts, geometría, transformaciones, config)
   viaja completo y se importa con remapeo de referencias validado en código.
4. **Pruebas interactivas de UI** (gestos de canvas, undo/redo con clics, arrastrar
   fotos): cubiertas por auditoría de código y por la validación matemática del
   motor, pero no ejecutadas de forma automatizada. Recomendación: pasar el flujo
   completo por el **Agente de Pruebas** de la plataforma (icono de tubo de ensayo,
   panel lateral), p. ej.: *"Crear un álbum 30×30, importar una carpeta de fotos,
   añadir un spread con layout 2×2, mover y recortar una foto y verificar que al
   reabrir el álbum todo se conserva"*.

---

# F. VALIDACIÓN DE NO DESTRUCCIÓN

- **Originales intactos**: sí — la carpeta se abre en modo solo lectura y ninguna
  parte del módulo escribe en disco.
- **Ningún JPEG sobrescrito ni subido**: sí — solo previews reducidas en IndexedDB
  local; a la base de datos únicamente llegan metadatos de texto/números.
- **Sin metadatos modificados**: sí — los archivos nunca se abren para escritura.
- **Lightroom sin tocar**: sí — ni plugin, ni flujos lr-*, ni `editflow-engine`.
- **Sin cambios en sistemas existentes**: sí — solo App.jsx (+1 import, +1 ruta) y
  Hub.jsx (+1 tarjeta), ambos 100 % aditivos y reversibles con borrar esas líneas.

---

# G. REGRESIÓN DE EDITFLOW (estado confirmado)

| Sistema | Estado |
|---|---|
| Hub | ✅ Funciona; solo se añadió la tarjeta aprobada |
| Navegación / rutas | ✅ Sin colisiones; `/album` nueva y aislada |
| Proyectos (entidades Core) | ✅ Operativos (verificado en la prueba) |
| Selección (Seleccion.jsx) | ✅ Intacto, sin modificaciones |
| Cerebro | ✅ Intacto |
| Editor existente (Ajustes IA) | ✅ Intacto; sin contaminación de historial |
| Lightroom (plugin + flujos) | ✅ Intacto (0 archivos Lua/backend tocados) |
| `editflow-engine` / `rawAi*` | ✅ Intactos |
| Proveedores IA | ✅ Intactos |

---

**FIN DE FASE 2.5.** Detenido. Sin correcciones aplicadas. Pendiente de decisión:
(1) corregir P1–P6 (todas son parches pequeños y locales al módulo), (2) aprobar
definitivamente la Fase 2, (3) pasar a la siguiente fase.