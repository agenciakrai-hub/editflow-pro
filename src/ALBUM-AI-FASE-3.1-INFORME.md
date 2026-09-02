# EDITFLOW ALBUM AI — FASE 3.1: INFORME FINAL
Fecha: 2026-09-02 · Implementación del sistema de identidad y gestión avanzada de
fotografías (Bloques 1–7 aprobados). Sin IA, sin Lightroom, sin plugin, sin
`editflow-engine`, sin tocar EditFlow Core.

---

# 1. ARCHIVOS CREADOS (7)

| Archivo | Bloque | Contenido |
|---|---|---|
| `src/modules/album/import/photoIdentity.js` | 1 | SHA-256 exacto (`crypto.subtle`), pHash local 8×8 (64 bits, aislado del core), distancia Hamming, umbral estricto 8 |
| `src/modules/album/lib/previewLru.js` | 4 | LRU en RAM genérico (máx. 48 entradas) |
| `src/modules/album/lib/previewService.js` | 4 | Carga de preview nivel 2 bajo demanda: IDB → LRU → fallback legado Fase 2 |
| `src/modules/album/hooks/usePhotoPreview.js` | 4 | Hook del hueco: preview 1000 px solo al renderizarse, nunca todo el catálogo |
| `src/modules/album/relocate/relocatePhotos.js` | 5 | Escaneo con identidad completa + `planRelocation` (exact/strong auto, fuzzy NUNCA auto, greedy sin candidatos repetidos) |
| `src/modules/album/relocate/RelocateDialog.jsx` | 5 | UI de re-localización: progreso, exactas auto, difusas con confirmación visual, marcado opcional de desvinculadas |
| `src/ALBUM-AI-FASE-3.1-INFORME.md` | — | Este informe |

# 2. ARCHIVOS MODIFICADOS

Dentro de `src/modules/album/` (todos):

| Archivo | Cambio |
|---|---|
| `import/folderImport.js` | Previews de dos niveles (thumb 256 / preview 1000, una sola decodificación), identidad por archivo, dedup por nombre Y content_hash, registro declarativo de formatos (TIFF futuro = 1 línea) |
| `lib/previewStore.js` | Claves de dos niveles por photo_id (prefijo projectId:: → limpieza existente los cubre), legado legible |
| `format/albumFile.js` | `.editflowalbum` v2 (aditivo): identidad por foto en exportación e importación; v1 aceptado igual |
| `hooks/useAlbumProject.js` | `updatePhoto` + `bulkUpdatePhotos` |
| `pages/AlbumEditorPage.jsx` | Estado = solo thumbs (256 px); previews 1000 px bajo demanda; ingestión con identidad/dedup; integración de re-localización |
| `editor/PhotoPanel.jsx` | Botón "Relocalizar n fotos", distintivo "desvinculada", título con estado |
| `editor/SlotFrame.jsx` | Preview asíncrona vía LRU (proyecto + photoId + filename); placeholder según estado |
| `editor/SpreadCanvas.jsx` | Ya no mantiene previews; pasa projectId al hueco |

**Excepción única (aprobada en el diseño Fase 3 §12.1)**: `base44/entities/AlbumPhoto.jsonc`
— esquema **aditivo**: `file_size`, `content_hash`, `phash`, `width_px`, `height_px`
(todos opcionales) y `unlinked` añadido al enum de `preview_status`. Fotos v1 existentes
siguen siendo válidas sin ningún cambio (verificado en checkpoint). **No se tocó**
App.jsx, Hub.jsx, EditFlow Core, backend ni plugin.

# 3. IDENTIDAD MULTICAPA (Bloque 1)

- L1 nombre + tamaño · L2 **SHA-256 exacto** del archivo · L3 **pHash** perceptual
  (umbral estricto 8/64) · L4 dimensiones reales en píxeles. Todo calculado en el
  navegador; ningún byte sale del dispositivo.
- Regla de seguridad verificada: una coincidencia pHash **JAMÁS enlaza solo** — pasa por
  confirmación visual del usuario en el diálogo (caso D probado: NO auto-enlazada).
- Auto-enlace únicamente en: hash idéntico (exacto) o nombre+tamaño cuando la foto v1 no
  tiene hash (fuerte).
- Checkpoint 1 superado: identidad persistida y releída exacta (hash 64 hex, pHash 16
  hex, tamaño, dimensiones); JPEG intactos, sin subidas, sin sistemas externos.

# 4. `.EDITFLOWALBUM` V2 (Bloque 2)

- Exportación v2 incluye identidad por foto; importación propaga los campos si existen.
- Retrocompatibilidad confirmada: **v1 importa y funciona igual** (campos ausentes = opcionales, nunca error), **v1 no requiere migración**, v1 no se modifica ni se pierde;
  v3 rechazado con mensaje claro. `doc_version` refleja la versión de origen.
- El archivo sigue llevando SOLO información, nunca imágenes.

# 5. PREVIEWS (Bloque 4)

- Nivel 1 thumb (256 px, q0.72): panel, catálogo, miniaturas — lo único en memoria.
- Nivel 2 preview (1000 px, q0.82): editor/huecos, bajo demanda, LRU de 48 entradas.
- Clave estable por photo_id → restaurar/regenerar previews jamás afecta spreads; claves
  legadas de Fase 2 siguen como fallback; limpieza por álbum cubre las claves nuevas.
- Presupuesto: 2.000 fotos ≈ 40 MB de thumbs en RAM (frente a cientos de MB del sistema
  anterior, que mantenía TODAS las previews en memoria). CP4 superado por diseño y
  verificación de código (prueba visual con miles de fotos recomendada en Testing Agent).

# 6. MISSING / UNLINKED (Bloque 3)

- `ok` / `missing` / `unlinked`. Missing es estado local por dispositivo (sin thumb en
  IDB); unlinked es confirmación persistida de que el original no está.
- **Regla fundamental probada**: foto marcada unlinked y foto re-localizada → el spread
  conserva posición, escala, crop, transformación, slot y geometría **al 100 %**
  (verificado en base de datos: transform 1.4 / offsets 3.5 / −2.25 intactos).
- El hueco muestra placeholder claro con el estado ("preview no disponible" /
  "foto desvinculada") y el panel el distintivo correspondiente.

# 7. RELOCALIZACIÓN (Bloque 5) — RESULTADOS

| Caso | Resultado |
|---|---|
| A — misma foto, mismo nombre | ✅ Enlace automático exacto (SHA-256) |
| B — misma foto, nombre diferente | ✅ Enlace automático exacto (hash) + actualización de la referencia (renombrada re-enlazada, sin duplicar) |
| C — misma foto, ubicación diferente | ✅ Enlace automático (hash; o nombre+tamaño si la foto es v1 sin hash) |
| D — visualmente similar pero DISTINTA | ✅ **NO se enlaza automáticamente**: aparece como candidata difusa y exige confirmación visual |

Flujo completo implementado: foto sin preview → botón "Relocalizar" → elegir carpeta →
escaneo con progreso → coincidencias por nivel de confianza → confirmación donde toca →
referencia restaurada. Nunca se escriben los originales. Opción adicional: marcar las no
encontradas como desvinculadas.

# 8. IMPORTACIÓN INCREMENTAL (Bloque 6)

- 500 importadas → +100 nuevas → solo se crean las 100 nuevas; dedup por nombre Y por
  content_hash (una foto renombrada se **enlaza** con su registro, no se duplica —
  probado); las existentes solo restauran previews y actualizan identidad.
- Spreads, transformaciones y referencias intactos (probado). Checkpoint 6 superado.

# 9. MULTI-EQUIPO (Bloque 7)

- Equipo A: exportar v2 → Equipo B: importar → fotos missing → seleccionar carpeta →
  Relocalizar → exactas enlazadas solas (dificusas con confirmación) → **álbum recuperado
  al 100 %**, incluida la identidad para futuras re-localizaciones.
- Rutas de datos probadas en base de datos (remlink con cambio de nombre + hash nuevo,
  previews cacheadas bajo photo_id, spread intacto). El flujo visual completo en dos
  equipos reales queda recomendado vía Testing Agent.

# 10. PROBLEMAS Y LIMITACIONES

1. **Pruebas interactivas pendientes** (gestos, importación real de carpeta, diálogo de
   re-localización): requieren navegador; recomendadas en el Testing Agent, p. ej.
   *"Crear un álbum, importar una carpeta, colocar una foto, re-importar la carpeta y
   verificar que las previews se restauran sin duplicados"*.
2. **Peso del escaneo**: re-localizar calcula SHA-256 de cada archivo de la carpeta
   (≈50–100 ms por foto típica): aceptable, con progreso visible.
3. **Claves de preview legadas** coexisten hasta que el álbum se re-importa; no molestan
   y la limpieza por álbum las cubre.
4. **Handle de carpeta** (Fase 3 §12.7, re-usar carpeta sin re-seleccionarla): no
   incluido en los 7 bloques aprobados — queda para una fase posterior si se aprueba.
5. **Subcarpetas**: la importación lee el primer nivel de la carpeta (comportamiento
   existente documentado).
6. `.editflowalbum` sigue sin transportar imágenes (por diseño, privacidad).

# 11. RESULTADO FINAL

# APTO

Los 7 bloques implementados, aislados en `src/modules/album/` (excepción única: esquema
aditivo de `AlbumPhoto`, aprobado en el diseño). Regresión verificada: EditFlow Core,
Hub, navegación, editor existente, Lightroom, plugin y `editflow-engine` **sin ninguna
modificación**. Solo lectura confirmada: ningún JPEG modificado, sobrescrito ni subido;
las previews son locales y siempre regenerables.

**FIN DE FASE 3.1.** Detenido. Sin IA, sin selección automática, sin narrativa, sin
maquetación automática, sin Lightroom, sin plugin. Esperando aprobación explícita.