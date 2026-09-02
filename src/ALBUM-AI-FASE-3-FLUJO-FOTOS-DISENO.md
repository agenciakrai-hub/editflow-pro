# EDITFLOW ALBUM AI — FASE 3: DISEÑO DEL FLUJO AVANZADO DE FOTOGRAFÍAS FINALES
Fecha: 2026-09-02 · FASE 2 APROBADA DEFINITIVAMENTE.
Documento exclusivamente de ANÁLISIS + DISEÑO. Sin código, sin implementar, sin tocar
Lightroom, el plugin, `editflow-engine`, EditFlow Core ni IA.

---

# 1. FLUJO DEFINITIVO DE FOTOGRAFÍAS

## 1.1 Pipeline recomendado

```text
LIGHTROOM (catálogo revelado, sin tocar)
    ↓  Exportar (flujo nativo de LR, controlado por el fotógrafo)
CARPETA LOCAL DE "FOTOGRAFÍAS FINALES" (JPEG, solo lectura)
    ↓  Importación (File System Access API, mode:"read")
EDITFLOW ALBUM AI (catálogo + previews locales + spreads)
```

Principios: Lightroom nunca se automatiza ni se modifica; la carpeta exportada es la
fuente única de verdad; el álbum solo lee y guarda referencias + geometría.

## 1.2 Especificación de exportación recomendada (guía, no requisito)

| Parámetro | Recomendación inicial | Motivo |
|---|---|---|
| Formato | JPEG sRGB | Universal, suficiente para maquetación; el original RAW nunca se necesita |
| Calidad | 90–100 | Evita artefactos al reescalar/crop virtual |
| Resolución | Lado largo 3500–4500 px (≈300 dpi en un spread 35×25 al 100 %) | Cubre el hueco más grande printable; se recomienda un solo tamaño para todo el álbum |
| Espacio de color | sRGB | Previsualización fiel en navegador |
| Estructura | Una carpeta por proyecto (subcarpetas permitidas) | La importación ya es recursiva y preserva `relative_path` |

TIFF/PNG: la arquitectura ya es agnóstica (la importación filtra por extensión/MIME y
la decodificación es vía `createImageBitmap`/canvas, que soporta TIFF en la mayoría de
navegadores modernos). No se implementa ahora; solo se documenta que la detección de
formatos es un único punto de la arquitectura (ver §6).

## 1.3 Contrato del módulo con la carpeta

- Solo lectura garantizada (`mode:"read"`); ningún archivo se modifica ni se sube.
- La carpeta puede contener más fotos que las importadas: la importación es aditiva.
- Si la carpeta desaparece, el álbum sigue siendo 100 % editable en su geometría; solo
  las previews nuevas dejan de estar disponibles (ver §5).

---

# 2. SISTEMA DE IDENTIDAD DE FOTOGRAFÍAS

Objetivo: reconocer una fotografía aunque se mueva, se renombre o se re-exporte.
Diseño **multicapa** (ningún identificador único por separado es fiable):

## 2.1 Capas de identidad

| Nivel | Identificador | Cómputo | Robustez | Uso |
|---|---|---|---|---|
| L0 | Nombre de archivo | Gratis | Baja (renombrar rompe) | Clave operativa de previews hoy; complemento |
| L1 | Nombre + tamaño en bytes (file_size) | Gratis | Media | Coincidencia rápida sin leer el archivo |
| L2 | **content_hash**: SHA-256 del archivo | `crypto.subtle.digest` en importación | **Alta (exacta)** | Re-localización exacta y anti-duplicados |
| L3 | **phash**: hash perceptual de la preview | Sobre la preview decodificada | Media (soporta re-compresión, re-export) | Re-localización difusa y dedup visual |
| L4 | Dimensiones reales (width_px × height_px) + orientación | Al decodificar | Complementaria | Desambiguación y validación |

## 2.2 Regla de decisión de identidad

```text
mismo content_hash                    → MISMA FOTO (exacto, sin confirmación)
mismo nombre + mismo file_size       → MISMA FOTO (fuerte, confirmación opcional)
phash distance ≤ umbral estricto     → CANDIDATA (difusa, SIEMPRE confirmación manual)
```

- El umbral pHash debe ser **estricto** (los reportajes contienen ráfagas casi
  idénticas): candidato difuso ≠ auto-enlace.
- Toda coincidencia difusa se presenta visualmente (miniatura original vs candidata)
  y la confirma el usuario. Nunca se auto-enlaza por pHash solo.
- `content_hash` y `phash` son **campos reservados nuevos** de `AlbumPhoto` (aditivos
  al esquema; sin migración, sin tocar entidades existentes de EditFlow).

## 2.3 Identidad vs. re-exportación de Lightroom

Re-exportar con distinta calidad cambia los bytes (L2 falla) pero no la imagen (L3
sigue). Por eso la identidad es multicapa: L2 para trabajo normal, L3 como red de
seguridad con confirmación humana.

---

# 3. SISTEMA DE REFERENCIAS LOCALES

Diseño de los tres almacenes locales (IndexedDB del módulo, hoy `editflow-album-db`):

## 3.1 Qué guarda cada uno

| Almacén | Contenido | Clave propuesta | Vida |
|---|---|---|---|
| previews | Miniaturas/previews JPEG (dataURL/Blob) | `photo_id` (hoy `projectId+filename` → evolucionar) | Hasta borrar el álbum |
| handles | `FileSystemDirectoryHandle` de la carpeta importada | `project_id` | Persistente (el handle es serializable en IDB) |
| entidad AlbumPhoto | Metadatos: nombre, ruta relativa, orientación, capture_time, tamaño, hashes (futuro), estado | `id` (servidor) | Permanente, viaja con el proyecto |

## 3.2 Reglas

- El handle permite re-abrir la carpeta SIN re-seleccionarla; el permiso se re-pide
  con `requestPermission` (flujo estándar de la FSA API, solo lectura).
- Los handles NUNCA viajan en `.editflowalbum` (no son portables entre equipos).
- Las referencias de servidor (photo_id) son la única clave compartible entre
  dispositivos; todo lo demás es local.
- Borrar un álbum limpia previews + handle + registros de las entidades (ya existe).

---

# 4. SISTEMA DE PREVIEWS

## 4.1 Diseño de dos niveles

| Nivel | Tamaño | Uso | Estimación por foto |
|---|---|---|---|
| **thumb** | 256 px lado largo, JPEG q≈0.7 | Panel de fotos, vista general de spreads | ~15–25 KB |
| **preview** | 1000 px lado largo, JPEG q≈0.8 | Canvas de edición, crop, zoom | ~150–300 KB |

## 4.2 Presupuesto para volúmenes objetivo (solo thumb en memoria)

| Fotos | Thumbs en memoria | Previews en IDB (bajo demanda) | IDB total estimado |
|---|---|---|---|
| 500 | ~10 MB | se cargan al abrir el spread | ~100–150 MB |
| 1.000 | ~20 MB | idem | ~200–300 MB |
| 2.000 | ~40 MB | idem | ~400–600 MB ⚠ ver cuota |

- **Nunca se cargan las fotos completas** (ni todas las previews) en memoria: el panel
  usa thumbs; la preview grande se solicita solo al renderizar un spread (LRU en RAM,
  p. ej. 30–50 entradas).
- IDB tiene cuota de navegador (≈10 % del disco, con `navigator.storage.estimate()`
  consultable): diseñar aviso proactivo si `usage > 80 %` de la cuota y limpieza de
  previews de álbumes antiguos bajo demanda.

## 4.3 Regeneración y limpieza

- Las previews SIEMPRE son regenerables desde la carpeta original (re-importar ya lo
  hace tras P1): la caché es prescindible por diseño.
- Invalidación por `photo_id` (si la foto se re-localiza, la preview se re-crea bajo su
  mismo id → ningún spread se toca).
- Limpieza: al borrar álbum (existente) + herramienta futura "purgar caché de previews"
  por álbum.

---

# 5. SISTEMA DE FOTOGRAFÍAS MISSING

## 5.1 Estados de una foto (evolución del `preview_status` actual)

| Estado | Significado | Spread |
|---|---|---|
| `ok` | Preview local disponible | Normal |
| `missing` | Preview no disponible en ESTE dispositivo / foto no encontrada | **Intacto**: posición, crop, escala y transformación se conservan |
| `unlinked` (futuro) | Se confirmó que el archivo original ya no está en la carpeta | Intacto |

## 5.2 Reglas inviolables

- **Un spread NUNCA pierde su geometría** por el estado de una foto: el hueco muestra
  un placeholder claro (icono + nombre de archivo) y conserva todos sus datos en mm.
- Si la foto reaparece (re-localización, re-importación), vuelve a renderizarse en su
  hueco exactamente igual: cero impacto en el diseño.
- Sustitución manual: arrastrar otra foto sobre el hueco cambia SOLO `photo_id` del
  slot (geometría intacta, ya soportado); la foto sustituida vuelve al catálogo.

---

# 6. FORMATOS FUTUROS (JPEG HOY, TIFF/OTROS MAÑANA)

- La decodificación actual ya es genérica (canvas/`createImageBitmap`), no está
  bloqueada a JPEG: el único punto de decisión de formato es la lista de extensiones
  admitidas al importar (un único array en un solo archivo del módulo).
- Diseño: mantener un **registro de formatos** declarativo (`ext → mime → decodificable`)
  para añadir TIFF/PNG/WebP sin tocar lógica de previews, identidad ni spreads.
- El hash de contenido (L2) y el pHash (L3) son independientes del formato: la
  identidad funciona igual si mañana entra un TIFF.
- No se implementa soporte adicional en esta fase.

---

# 7. FLUJO MULTI-EQUIPO (Fase 3 diseñada, no implementada)

```text
EQUIPO A: Álbum completo → EXPORTAR .editflowalbum (v2, ver §10)
EQUIPO B: IMPORTAR .editflowalbum → catálogo + spreads completos, FOTOS SIN PREVIEWS
          → seleccionar la MISMA carpeta exportada (o una copia)
          → re-localización por content_hash (exacta) → previews restauradas
          → álbum recuperado al 100 %
```

Qué viaja / qué no:

| Sí viaja (.editflowalbum) | No viaja (local de cada equipo) |
|---|---|
| Config del álbum (mm, unidades, márgenes) | Previews (IndexedDB) |
| Catálogo: nombres, rutas, orientación, fechas | Handle de carpeta (FSA) |
| **Novedad v2**: file_size, content_hash, phash, dimensiones | Cualquier imagen |
| Spreads completos: orden, layouts, slots, geometría mm, transformaciones | |

- **Nunca se duplican fotografías**: la re-localización enlaza por hash con los
  registros existentes; si se "importa" una foto que ya está en el catálogo, se enlaza,
  no se crea (extensión de la regla de nombres de P1 a la regla de hashes).
- Caso límite: Equipo B tiene la MISMA carpeta ya exportada → re-importación directa
  restaura previews (funcional desde Fase 2.6); la re-localización formal solo se
  necesita cuando los nombres difieren.

---

# 8. IMPORTACIÓN INCREMENTAL

Comportamiento diseñado (el esqueleto ya existe tras P1):

```text
Importación 1: 500 fotos → catálogo + previews
Semana después: +100 fotos nuevas en la misma carpeta
Importación 2 → SOLO las 100 nuevas se crean; las 500 no se duplican
               (hoy: por nombre; diseño: TAMBIÉN por content_hash)
Spreads/transformaciones: NUNCA tocados por una importación
```

- Doble filtro anti-duplicado: nombre (actual) + `content_hash` (futuro, evita el
  duplicado lógico cuando una foto entra renombrada).
- Fotos ya existentes: se regenera/cache su preview (restauración, P1) y nada más.
- El orden del catálogo es cronológico (`capture_time`) y aditivo; las nuevas fotos
  se ordenan en su lugar natural, sin reordenar nada.

---

# 9. PREPARACIÓN DEL CATÁLOGO PARA LA IA (solo requisitos, sin implementar)

La cadena futura `CATÁLOGO → PHOTO ANALYSIS → AI SELECTION → AI STORY → AI LAYOUT`
necesitará disponible por foto:

| Información | Estado actual | Necesario para IA |
|---|---|---|
| Identidad estable (id, hashes) | id ✓ / hashes = Fase 3.1 | Análisis sin re-procesar |
| Orientación + dimensiones reales | Orientación ✓ / px = Fase 3.1 | Elegir layouts compatibles |
| capture_time | ✓ | Narrativa / orden temporal |
| Metadatos EXIF (cámara, focal) | Reservado | Categorización de escenas |
| Preview accesible (dos niveles) | ✓ (a unificar en 3.1) | Entrada visual de modelos |
| Campos `ai_state`, `ai_rank`, `ai_scores`, `ai_category` | **Ya reservados en el esquema** | Salida de selección IA |
| `spread.locked` / `ai_generated` | **Ya reservados** | La IA respeta el trabajo manual |
| Referencias slot→photo con transformación | ✓ | Retroalimentación de layout IA |

Conclusión: el esquema ya reserva los campos IA; Fase 3.1 solo añade identidad px/hash.
La futura IA nunca necesitará los archivos originales, solo previews (privacidad igual
que en Selección de EditFlow).

---

# 10. `.EDITFLOWALBUM` — REVISIÓN DEL FORMATO (DOCUMENTADA, NO CAMBIADA)

**Conclusión: el formato actual (v1) debe EVOLUCIONAR de forma aditiva a v2 antes de
la Fase 3.1 de re-localización.** No es bloqueante para nada ya construido y NO
requiere migración de proyectos existentes.

1. **Qué debe cambiar (v2, aditivo)**: incluir en cada foto del documento
   `file_size`, `content_hash`, `phash`, `width_px`, `height_px` (hoy solo viajan
   nombre/ruta/orientación/fecha). Sin ellos, Equipo B no puede re-localizar por
   identidad exacta ni validar candidatos.
2. **Por qué**: son los datos que hacen posible el flujo multi-equipo (§7) y el
   anti-duplicado (§8) sin imágenes.
3. **Compatibilidad**: v1 se seguirá importando sin cambios (los campos v2 son
   opcionales; si faltan, los hashes se calculan al re-importar la carpeta). v2 se
   escribe con `doc_version:"v2"` y el lector acepta `"v1" | "v2"`.
4. **Migración**: ninguna. Los proyectos v1 existentes siguen funcionando; el campo
   `doc_version` ya existe desde Fase 1 exactamente para esto.

---

# 11. RIESGOS Y LIMITACIONES

| Riesgo | Severidad | Mitigación de diseño |
|---|---|---|
| pHash: ráfagas casi idénticas → falsos positivos | Media | Umbral estricto + confirmación visual SIEMPRE en coincidencias difusas |
| Cuota IndexedDB con 2.000+ fotos | Media | Thumbs pequeños, previews bajo demanda, aviso de cuota, purga por álbum |
| Re-export de LR cambia bytes (hash exacto falla) | Baja | Multicapa: pHash + confirmación manual |
| Carpeta movida/renombrada | Baja | Estados missing claros + re-localización (§5, §7) |
| FSA no disponible (Safari/Firefox antiguos) | Media | Ya existe fallback con `<input type=file multiple>`; la re-localización también funcionará sobre archivos sueltos |
| Fotos nunca se suben → otro equipo SIN carpeta no ve imágenes | Por diseño | Documentado: es la garantía de privacidad del módulo |
| Handle de carpeta pierde permiso al cerrar | Baja | Re-petición de solo lectura al reabrir (flujo estándar FSA) |

---

# 12. PLAN TÉCNICO PARA LA FASE 3.1 (IMPLEMENTACIÓN, APROBACIÓN PENDIENTE)

Orden propuesto, todo local a `src/modules/album/` + esquema aditivo de `AlbumPhoto`
(ningún cambio en backend, plugin, IA ni EditFlow Core):

1. **Esquema aditivo** de `AlbumPhoto`: `file_size`, `content_hash`, `phash`,
   `width_px`, `height_px` (todos opcionales; proyectos existentes intactos).
2. **Identidad en importación**: SHA-256 (`crypto.subtle`) + pHash en `makePreview`;
   doble filtro anti-duplicado (nombre + hash) en `ingestFiles`.
3. **Previews v2**: claves por `photo_id`, dos niveles (thumb 256 / preview 1000),
   LRU en RAM del canvas, migración suave de claves antiguas (si no existe la nueva
   clave, se regenera — la caché es prescindible por diseño).
4. **Estados missing/unlinked**: UI de panel y placeholder de slot con botones
   "Relocalizar foto" y "Relocalizar carpeta".
5. **Re-localización**: escaneo de carpeta elegida → coincidencias exactas (hash)
   auto-enlazadas → candidatas difusas (pHash) con confirmación visual →
   `preview_status` actualizado; jamás se escribe en los archivos.
6. **`.editflowalbum` v2**: escritura/lectura de los campos de identidad (§10),
   aceptando v1 sin cambios.
7. **Handles**: persistir el handle de carpeta por proyecto en IDB con re-petición de
   permiso de lectura al reabrir (elimina re-seleccionar carpeta en cada sesión).

Cada paso es independiente y verificable; ninguno toca spreads, transformaciones ni
sistemas existentes.

---

**FIN DE FASE 3 (diseño).** Detenido. Sin código. Esperando aprobación explícita
antes de cualquier implementación (Fase 3.1) y de la decisión sobre `.editflowalbum` v2.