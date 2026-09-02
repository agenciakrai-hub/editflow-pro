# EDITFLOW ALBUM AI — FASE 4.0: VALIDACIÓN TÉCNICA DEL PLAN DE IMPLEMENTACIÓN
Fecha: 2026-09-02 · Fase exclusivamente de REVISIÓN. **No se ha implementado código, ni
creado backend, ni modificado archivo alguno.** Fuente de esta validación: lectura
directa de `base44/shared/aiProviderAdapter.ts` (completo), de la guía de funciones
backend de la plataforma, de la estructura real de `src/modules/album/` y de las
entidades `Album*` vigentes tras la Fase 3.1.

---

## 1. ARQUITECTURA ACTUAL REVISADA (hechos verificados, no supuestos)

### 1.1 Módulo album (`src/modules/album/`)

```text
pages/      AlbumApp.jsx (switcher único: ?project= → editor | sin param → lista)
            AlbumsPage.jsx, AlbumEditorPage.jsx
editor/     SlotFrame, SpreadCanvas, PhotoPanel, LayoutPanel, SpreadToolbar, AlbumOverview
manager/    albumStore.js (spreads + undo/redo + autosave)
import/     folderImport.js (previews 2 niveles + identidad), photoIdentity.js
relocate/   relocatePhotos.js, RelocateDialog.jsx
lib/        previewStore.js (IDB 2 niveles, clave photo_id), previewLru.js,
            previewService.js, albumUnits.js
hooks/      useAlbumProject.js (CRUD entidades), usePhotoPreview.js
format/     albumFile.js (.editflowalbum v1/v2)
layout/     layoutCatalog.js, layoutEngine.js
```

- **Previews**: IndexedDB propio (`editflow-album-db`), dos niveles (thumb 256 px q0.72 /
  preview 1000 px q0.82) con clave estable `${projectId}::${photoId}::tier`; LRU de 48
  en RAM para el nivel 2; fallback a claves legadas por nombre. **Las previews solo
  existen en el navegador** — el backend NO puede leerlas. Este hecho gobierna todo el
  diseño de ejecución (sección 8).
- **Identidad multicapa** (Fase 3.1, verificada): `file_size`, `content_hash` (SHA-256),
  `phash` (64 bits), `width_px/height_px` en `AlbumPhoto`, más `preview_status`
  (ok/missing/unlinked). PHash/SHA ya calculados en cliente.
- **Persistencia**: entidades `AlbumProject`, `AlbumPhoto`, `AlbumSpread` con RLS por
  `created_by_id`; campos reservados ya presentes en `AlbumPhoto`: `ai_state`
  (recommended/considered/discarded/unreviewed), `ai_rank`, `ai_scores`, `ai_category`.
- **Aislamiento verificado** (Fase 2.5 y 3.1): el módulo no importa librerías del core.

### 1.2 Sistema de proveedores IA existente (`base44/shared/aiProviderAdapter.ts`, leído íntegro)

- **Seam de transporte único**: `invokeVision({ task, prompt, file_urls, response_json_schema, forceProvider })`.
  Transporte a: base44 (InvokeLLM), Qwen (DashScope OpenAI-compatible), NVIDIA NIM,
  Gemini (inline base64 nativo), y `custom:<id>` (entidad `CustomAiProvider`). Devuelve
  JSON ya parseado (parse robusto que limpia fences y bloques de razonamiento).
- **Failover**: `invokeVision` SIN `forceProvider` construye cadena [activo → customs
  habilitados → qwen/gemini/nvidia habilitados → base44 último recurso] y reintenta. CON
  `forceProvider`: proveedor único, sin failover.
- **Config**: el ruteo lee `AiProviderConfig` (entidad **admin-only**, leída con service
  role) por TAREA: solo existen `active_seleccion` y `active_ajustes`. **No existe tarea
  "album"** y las claves/endioints/modelos (QWEN_API_KEY, GEMINI_API_KEY,
  NVIDIA_API_KEY, endpoints, modelos) residen ahí o en secrets — nunca en el frontend.
- **Timeout real**: 120 s por llamada de proveedor (AbortController); Gemini reintenta
  429/503 con backoff (2s, 4s); Qwen/NVIDIA/custom no reintentan dentro del adaptador.
- Datos de entrada: `file_urls` como data URLs (`data:image/jpeg;base64,...`) —
  confirmado soportado por NVIDIA, Gemini y custom; **Qwen requiere URL http** (en el
  core la genera con UploadFile). Limitación verificada que afecta al diseño (sección 7).

### 1.3 Backend existente

- `editflow-engine` (monolito del core: proyectos, XMP, sync Lightroom, tokens plugin) —
  **intocable**. `rawAiSmartSelect` (culling por ráfagas del core), `rawAiStudioAnalyze`,
  `rawAiVisualDevelop`, `rawAiHybridProfile`, `rawAiDedupCompare`, `styleGalleryAnalyze`,
  `ai-providers` (config), `create-checkout`, `payments-webhook`. Patrón común
  verificado: **el frontend envía previews/data URLs al function; el function enruta al
  proveedor y devuelve JSON** — exactamente el patrón que reutilizará `album-engine`.
- Restricciones de plataforma verificadas (guía de funciones): handler único
  `export default async function(req): Promise<Response>`, try/catch del cuerpo,
  autenticación con `base44.auth.me()` (401 si no), parámetros SOLO por payload,
  secretos solo en backend (`secrets.get`), `waitUntil` para trabajo post-respuesta, y
  la advertencia explícita de **no cargar datasets completos en memoria**.

---

## 2. ARQUITECTURA PROPUESTA PARA LA FASE 4.1 (flujo exacto)

```text
EDITFLOW ALBUM AI (navegador — orquestador ÚNICO, porque las previews viven en IDB)
        ↓ E2 · LOCAL: métricas técnicas sobre la preview 1000 px (canvas) → sin coste
        ↓ E3 · LOCAL: grupos con phash (ya existente) + Δt + coherencia → sin coste
ANÁLISIS LOCAL + PREPARACIÓN DE DATOS
        ↓ Construcción de lotes: thumb 256 px re-codificado + alias + metadatos mínimos
¿QUÉ SE ENVÍA? (sección 5 — nunca originales, nunca rutas, nunca hashes)
        ↓ base44.functions.invoke("album-engine", { action, batch, consent })
album-engine (function nuevo, aislado, sin estado, sin persistir imágenes)
        ↓ invokeVision({ forceProvider }) sobre base44/shared/aiProviderAdapter.ts (solo lectura)
PROVEEDOR IA (chain de failover propia del módulo, orden definido por AlbumAIConfig)
        ↓ JSON normalizado + validado + versionado (provider, model, latency)
RESULTADO (persistido en entidades Album* desde el cliente, con progreso por etapa)
        ↓ E4 triaje → E5 grupos → E6 momentos → E7 conjunto
SELECCIÓN (informe completo + explicaciones + embudo visible + overrides del fotógrafo)
```

Puntos clave validados contra la arquitectura real:

1. **El cliente orquesta** (no hay job de backend duradero): es la única opción posible
   porque las previews están en IndexedDB del navegador, y además permite abortar,
   reanudar y mostrar progreso real. El backend es un proxy sin estado por lote.
2. **`album-engine` nunca persiste imágenes**: los data URLs se procesan en memoria y se
   descartan; solo se devuelven y persisten los JSON de análisis.
3. **Los resultados se guardan desde el cliente** en las entidades `Album*` (RLS del
   usuario, igual que toda la persistencia del módulo), no desde el function — el
   function no necesita service role para datos del usuario.

---

## 3. LÍMITE EXACTO DE `album-engine`

### 3.1 DEBE

- Ser un function nuevo e independiente (`base44/functions/album-engine/entry.ts`).
- Tener responsabilidades EXCLUSIVAS de Album AI (las acciones E4–E7 + diagnóstico).
- NO tocar `editflow-engine`, entidades del core, `AiProviderConfig` en escritura, ni
  ningún otro motor. Importa `base44/shared/aiProviderAdapter.ts` **en modo solo
  lectura** como seam de transporte (sección 7 — sin modificarlo).

### 3.2 ENTRADAS (payload exacto por acción — parámetros solo por payload, verificado)

```text
action:"e4-triage"    { projectId, event_type, batch:[ { alias, thumb, orientation,
                        capture_time, local_tech } × ≤20 ] }
action:"e5-group"     { projectId, event_type, group:[ { alias, thumb, capture_time,
                        local_tech, e4_summary } × ≤12 (grupos mayores → sub-lotes) ],
                        group_kind }
action:"e6-moments"   { projectId, event_type, representatives:[ { alias, thumb,
                        group_kind, e5_summary } × ≤24 ] }
action:"e7-assembly"  { projectId, event_type, album_target:{ spreads, per_spread },
                        descriptors:[ { alias, moment, category, dims, phrase } ] }  ← SOLO TEXTO
action:"providers-test" { }   → diagnóstico (key present, latencia, modelo) por proveedor
```

- `thumb`: data URL JPEG 256 px q0.72 (≈ 15–30 KB c/u; lote de 20 ≈ 400–600 KB — muy
  por debajo de cualquier límite razonable de payload de function).
- `alias`: identificador efímero (p. ej. `p17`) que el cliente correlaciona con su
  photo_id. **No se envían** `filename`, `relative_path`, `content_hash` ni `phash`.
- `local_tech`: las 4–6 métricas de E2 (números, sin imagen).
- `consent: true` en toda acción remota (sección 6): el function lo exige.

### 3.3 SALIDAS (JSON normalizado, validado y versionado)

```text
e4 → { analyses:[ { alias, dims:{technical,aesthetic,people|null}, confidence, reasons } ],
       provider, model, latency_ms }
e5 → { promoted:[alias], per_photo:[ { alias, dims, group_rank, reasons } ],
       group_summary, provider, model }
e6 → { moments:[ { name, archetype, group_aliases[], order, summary } ], provider, model }
e7 → { selection:[ { alias, role, reasons, tech_exception } ],
       funnel_report, coverage, provider, model }
providers-test → { per_provider:[ { ok, reason, latency_ms, key_present } ] }
Errores → { error, stage, provider_failed, retriable } (HTTP 500 con cuerpo tipado)
```

### 3.4 JOBS

No hay jobs de backend: el "job" es la ejecución del pipeline orquestada por el cliente
y registrada en la entidad `AlbumAISelection` (sección 10):

| Concepto | Mecanismo |
|---|---|
| Inicio | El usuario pulsa "Analizar con IA" (previo consentimiento); se crea `AlbumAISelection` status=`running` con `stage_progress` |
| Progreso | Cliente actualiza `stage_progress` tras cada lote persistido (E4: x/total lotes, E5: g/G grupos…) |
| Error de lote | Se reintenta hasta 2 veces con backoff; si persiste, el lote queda `failed` y el job pasa a `failed(etapa)` reanudable desde ese punto |
| Cancelación | Flag en el cliente (`AbortController` + check entre lotes); job → `canceled`, lo completado se conserva |
| Reintento/Reanudar | Re-ejecutar = procesar solo lotes/etapas sin análisis persistido (por foto y por grupo) |

---

## 4. DATOS PROCESADOS LOCALMENTE (tabla justificada sobre la arquitectura real)

| Análisis | Local | Remoto | Motivo (basado en la arquitectura verificada) |
|---|---|---|---|
| SHA-256 (duplicado exacto) | ✅ Ya existe (`content_hash`, Fase 3.1) | — | Ya calculado en cliente en la importación; coste cero |
| pHash (similaridad visual) | ✅ Ya existe (`phash`, Fase 3.1) | — | Ídem; además `phashHexDistance` ya implementado y probado |
| Ráfagas / grupos | ✅ E3 | — | `capture_time` + pHash ya persistidos; agrupar es determinista y gratis; enviar 42 variantes de una ráfaga a IA sería coste puro sin información nueva |
| Calidad técnica (nitidez, exposición, ruido, WB, rango) | ✅ E2 (canvas sobre preview 1000 px) | Refinado ligero en E4 | Laplaciano/histograma/percentiles son métricas clásicas calculables en navegador sobre un canvas ya disponible; el VLM solo refina para no gastar llamadas en lo medible |
| Estética (composición, luz, color, impacto) | ❌ Heurísticas locales no fiables | ✅ E4 | Requiere comprensión visual; no hay modelo local viable en navegador |
| Emoción/expresión/mirada | ❌ | ✅ E4/E5 | Ídem; y en E5 es comparativa dentro del grupo (contexto que multiplica la calidad) |
| Momento (instante decisivo, singularidad) | ❌ | ✅ E5 | Solo tiene sentido comparando la ráfaga junta |
| Narrativa / momentos / conjunto | ❌ | ✅ E6/E7 | Es la dimensión de la historia completa; en E7 se hace SOLO con texto (baratísimo) |
| Embeddings | — (diferido) | — | Evaluable en fase posterior (sección 9); no entra en 4.1 |

Justificación de estructura (no decisión predeterminada): E2/E3 son locales **porque los
datos ya existen en el dispositivo** (identidad Fase 3.1 + canvas de previews) y porque
eliminan el 50–60 % del volumen antes de gastar; E4–E7 son remotos **porque ninguna
heurística local comprende emoción o narrativa** con fiabilidad profesional.

---

## 5. DATOS PROCESADOS REMOTAMENTE — QUÉ SALE EXACTAMENTE DEL DISPOSITIVO

### 5.1 NUNCA (confirmado sobre la arquitectura)

- **RAW**: nunca sale. El módulo album ni siquiera acepta RAW como entrada (solo
  jpg/jpeg/png, registro declarativo `SUPPORTED`).
- **JPEG/TIFF original**: nunca sale automáticamente ni manualmente: no existe flujo de
  subida de originales en el módulo (fase 3 auditada: cero escritura, cero subida); TIFF
  ni siquiera está soportado por el registro de formatos actual.
- **Estructura de carpetas**: `relative_path` y `filename` completos no se envían.
- **`content_hash` / `phash`**: identidad interna; no viajan.

### 5.2 POSIBLEMENTE (definición exacta)

| Dato | Resolución máx. | Formato | Tamaño aprox. | Cuándo |
|---|---|---|---|---|
| Thumb (E4, E6, representantes E5) | 256 px borde mayor (re-escala del thumb ya existente) | JPEG q0.72, data URL base64 | 15–30 KB c/u | Lotes E4 (≤20), E5 (≤12), E6 (≤24) |
| Preview (solo si E5 lo exige para grupos de retrato) | 1000 px borde mayor | JPEG q0.82, data URL | 150–400 KB | Opcional, configurable OFF por defecto |
| Metadatos | — | Números | <1 KB | capture_time, orientation, dimensiones, local_tech, alias |
| Descriptores E7 | — | JSON texto | <30 KB total | Solo texto, sin imagen |
| Embeddings | — | — | — | NO en 4.1 (diferido) |

**Limitación verificada que afecta a la selección de proveedores**: Qwen requiere
`file_urls` http (el core la genera con `UploadFile`, que SUBE la imagen al almacenamiento
de la app). Para preservar el principio "nada se sube", `album-engine` con Qwen debería
o bien usar también data URL si DashScope los acepta en modo compatible (verificar en
4.1 con un ping real) o bien marcar Qwen como proveedor con upload y requerir
consentimiento adicional. **Gemini, NVIDIA y custom aceptan data URLs inline verificado
en el adaptador.** Base44 InvokeLLM requiere UploadFile (misma consideración que Qwen).
Este matiz se resuelve en el Bloque 3 de 4.1 con una prueba por proveedor antes de
habilitarlo en la cadena.

---

## 6. PRIVACIDAD Y CONSENTIMIENTO

Flujo conceptual obligatorio antes de CUALQUIER llamada remota:

```text
ANÁLISIS REMOTO → INFORMACIÓN AL USUARIO → CONSENTIMIENTO → ENVÍO
```

- **Qué se informa**: número de fotos y lotes previstos, tamaño total aproximado de lo
  que saldrá ("~550 miniaturas de 256 px, ~12 MB"), proveedor activo y cadena de
  failover, qué NO sale (originales, rutas, hashes), y coste estimado en llamadas.
- **Qué acepta el usuario**: ejecutar la etapa actual o el pipeline completo; aceptar la
  cadena de proveedores propuesta o restringirla (p. ej. solo-Gemini). Nada de "aceptar
  todo para siempre" por defecto.
- **Configuración permanente**: `AlbumAIConfig` por usuario (entidad del módulo):
  `consent_mode: per_run | saved`, `allowed_providers[]`, `send_preview_1000: false`,
  `preferred_order`. Si `saved`, el consentimiento por ejecución se reduce a un
  confirmación ligera con el resumen de volumen. Se persiste la fecha y el texto
  aceptado en cada `AlbumAISelection` (trazabilidad).
- **Revocación**: en cualquier momento desde la configuración del módulo: vaciar
  `allowed_providers` o poner `consent_mode: per_run` = ninguna llamada sale sin
  confirmación; revocar NO borra análisis pasados (el usuario puede purgarlos borrando
  el álbum o desde la propia UI).
- La UI de consentimiento NO se implementa en 4.0 (solo su definición); se implementará
  en el Bloque 3 de 4.1 junto al primer endpoint remoto.

---

## 7. SISTEMA DE PROVEEDORES — ANÁLISIS CON LAS OPCIONES REALES (verificadas)

### OPCIÓN A — `album-engine` con transporte propio independiente

Duplicaría `callQwen/callNvidia/callGemini/callCustom` (~200 líneas) dentro del function
con su propia configuración. **Riesgo**: divergencia de bugs/mejoras respecto al
adaptador (p. ej. el parse de razonamiento `<think>` ya sufrió un bug real corregido en
el core; una copia no lo recibiría). **Acoplamiento**: cero. **Mantenimiento**: doble.
**Coste**: igual. **Seguridad**: igual (mismos secrets). Nota: chocaría con la regla de
plataforma de extraer lógica compartida a `base44/shared/` en vez de copiarla.

### OPCIÓN B — usar `invokeVision({ task: "seleccion" })` directamente

**RECHAZADA (verificado)**: el ruteo por tarea solo conoce `seleccion`/`ajustes` y lee
`AiProviderConfig` (admin del core). Un cambio de proveedor para el culling del core
cambiaría el comportamiento del álbum; habilitar/deshabilitar proveedores del core
afectaría al álbum; y no existiría configuración propia del módulo (requisito aprobado
en Fase 4). Acoplamiento semántico alto sin necesidad.

### OPCIÓN C — reutilizar el seam en solo lectura: `invokeVision({ forceProvider })` ⭐ RECOMENDADA

`album-engine` lee SU configuración (`AlbumAIConfig`) y construye SU cadena de failover;
para cada eslabón llama a `invokeVision({ forceProvider })` del adaptador compartido
**sin modificarlo**. Verificado en el código real: `forceProvider` soporta
`qwen|nvidia|gemini|base44|custom:<id>`, y el failover con `forceProvider` está
desactivado por diseño — justo lo que el módulo necesita orquestar por su cuenta.

| Criterio | Evaluación |
|---|---|
| Riesgo | ✅ Mínimo: dependencia de solo lectura de un seam explícitamente diseñado para sustituir transporte; ningún sistema existente cambia de comportamiento |
| Acoplamiento | ✅ Una firma de función (`invokeVision`); la política (cadena, consentimiento, coste) queda en el módulo |
| Mantenimiento | ✅ Las mejoras de transporte del core (timeouts, parse, nuevos proveedores OpenAI-compat) fluyen gratis al álbum |
| Coste | ✅ Idéntico (mismos proveedores, mismas keys ya en secrets: QWEN, GEMINI, GEMINI_PAID, NVIDIA + InvokeLLM) |
| Seguridad | ✅ Idéntica: las API keys nunca salen del backend; el adaptador nunca las devuelve |

**Trade-off documentado**: endpoints/modelos de Qwen/Gemini/NVIDIA siguen leyéndose de
`AiProviderConfig` (configuración de plataforma, una sola por app). La selección de
proveedor y la CADENA son del módulo; el endpoint/modelo es del administrador. Si se
requiriese independencia total de endpoints, la opción A queda como plan B. **No se
modifica nada** en ninguna de las opciones elegidas salvo crear archivos nuevos.

---

## 8. JOBS Y EJECUCIÓN — MODELO POR TAMAÑO DE CATÁLOGO

Parámetros verificados que dimensionan el modelo: timeout de proveedor 120 s/call,
payload solo por body (lotes de ~0,5 MB sin problema), `waitUntil` disponible para
post-respuesta, y el patrón core ya probado de lotes con previews base64.

| Catálogo | Grupos est. | Lotes E4 (≤20) | Llamadas E5 | Llamadas E6 | E7 | Total est. | Duración est. (2–3 lotes en paralelo, ~10–20 s/lote) |
|---|---|---|---|---|---|---|---|
| 100 | ~40 | 5 | 40 | 2–3 | 1 | ~50 | 3–6 min |
| 500 | ~180 | 25 | 180 | 4–6 | 1 | ~215 | 15–35 min |
| 1.000 | ~350 | 50 | 350 | 6–10 | 1–2 | ~415 | 35–70 min |
| 2.000 | ~700 | 100 | 700 | 8–15 | 2 | ~820 | 1,5–3 h |

Decisiones de ejecución derivadas de la arquitectura real:

- **Procesamiento por lotes**: E4 en lotes de 20 thumbs; E5 un lote por grupo (grupos
  > 12 fotos → sub-lotes con consolidación tipo multi-paso, patrón ya probado en
  `rawAiSmartSelect`); E7 una llamada de texto.
- **Progreso**: granular por lote/grupo, persistido en `AlbumAISelection.stage_progress`
  tras cada persistencia de resultados (nunca por foto individual → no hammers la BD).
- **Cancelación**: `AbortController` del cliente + check del flag entre lotes; lo
  persistido se conserva; job → `canceled`.
- **Reintentos**: 2 por lote con backoff (la app ya padece 429 de NVIDIA documentado →
  throttling adaptivo obligatorio: si un proveedor devuelve 429, se espacia y se baja
  el paralelismo; el failover de cadena actúa si el error no es transitorio).
- **Recuperación tras cerrar la aplicación**: VERIFICADO como el punto más delicado.
  Al reabrir, el editor detecta `AlbumAISelection` en `running/canceled/failed` y ofrece
  "Reanudar": el pipeline relee los análisis persistidos por foto (`AlbumPhotoAnalysis`)
  y solo procesa lotes sin resultado (cache por `content_hash` acelera lo re-analizado).
  El trabajo no se pierde aunque se cierre el navegador a mitad; lo NO persistido se
  recalcula.

---

## 9. COSTE Y OPTIMIZACIÓN (sin proveedor definitivo — faltan datos reales)

- **Tipo de modelo necesario**: VLM multimodal de visión (acepta imágenes en el chat)
  para E4–E6 — mismo tipo que ya usa el core para culling. E7 requiere solo razonamiento
  sobre texto (cualquier LLM de la cadena vale, incluido un modelo "flash").
- **Proveedores disponibles HOY (secrets verificados)**: Qwen (DashScope, qwen3-vl-plus),
  Gemini (GEMINI_API_KEY y GEMINI_API_KEY_PAID, gemini-3.6-flash), NVIDIA NIM
  (minimax-m3, con historial de 429), Base44 InvokeLLM (consum créditos de integración,
  y cuenta con la limitación de créditos ya documentada en el proyecto), más
  `CustomAiProvider` custom. Todos acceden por el mismo seam (opción C).
- **Qué reduce el coste el análisis local**: el 50–60 % de las llamadas se evita antes
  de gastar (grupos y pre-filtrado técnico en local). Las llamadas E5/E6 usan thumbs de
  256 px — entrada pequeña = coste por llamada bajo en cualquier proveedor.
- **Qué se puede cachear**: análisis individual E4 por `content_hash` (la misma foto en
  otro álbum del mismo usuario no se re-analiza); E2/E3 recalculables al instante;
  E5–E7 NUNCA se cachean (dependen del contexto del álbum concreto).
- **Medición obligatoria en 4.1** (Bloque 3): el primer hito de `album-engine` es un
  `providers-test` + una ejecución de coste real con 100 fotos midiendo: latencia por
  lote, llamadas reales vs estimadas, y coste en el proveedor activo. Con esos datos se
  fija el proveedor por defecto del módulo. **No se selecciona proveedor definitivo hoy.**

---

## 10. DATOS Y PERSISTENCIA (dónde vive cada cosa en 4.1)

| Dato | Dónde | Persistencia | ¿Recalcular? |
|---|---|---|---|
| Previews/thumb/preview 1000 | IndexedDB (ya existe) | Permanente local | Regenerables re-importando |
| E2 métricas técnicas | `AlbumPhotoAnalysis` (nueva) | Permanente BD | Recalculable al instante (local) |
| E3 grupos (ids, representante, promoted) | `AlbumPhotoGroup` (nueva) | Permanente BD | Recalculable (determinista) |
| E4 análisis individual + reasons | `AlbumPhotoAnalysis` | Permanente BD | Cacheado por content_hash |
| E5 decisión de grupo | `AlbumPhotoGroup` | Permanente BD | Re-corrible (coste IA) |
| E6 momentos | `AlbumMoment` (nueva) | Permanente BD | Re-corrible; editable a mano |
| E7 selección final + embudo + config | `AlbumAISelection` (nueva) | Permanente BD, histórica (no se machaca) | Cada ejecución = un informe nuevo |
| Overrides del fotógrafo | campos aditivos en `AlbumPhoto` (+ `ai_state` ya existente) | Permanente BD | Nunca se recalculan |
| Feedback/decisiones | `AlbumAIFeedback` (nueva, solo registro — sin aprendizaje) | Permanente BD | Nunca |
| Config proveedores/consentimiento | `AlbumAIConfig` (nueva) | Permanente BD | — |
| Estado del job (progreso por etapa) | `AlbumAISelection.stage_progress` | Permanente BD | — |
| Lotes en vuelo (alias↔photo_id, datos remotos crudos) | RAM del cliente | TEMPORAL | Sí, si se pierde |
| Imágenes enviadas | Memoria del function (nunca BD, nunca storage) | TRANSITORIA | No aplica |

Regla de recálculo tras overrides: un cambio del fotógrafo re-corre SOLO la etapa
afectada (E7, a lo sumo E6), jamás E2–E4 (persistidos y cacheados).

---

## 11. ROLLBACK DE FASE 4.1

Objetivo: "DESACTIVAR ALBUM AI" dejando intactos editor manual, álbumes existentes,
Lightroom, Core y `editflow-engine`.

| Nivel | Acción | Efecto |
|---|---|---|
| 1 · Feature flag (por usuario) | `AlbumAIConfig.enabled = false` → oculta la pestaña Selección IA | Cero riesgo; reversible |
| 2 · Rollback de código frontend | Borrar `src/modules/album/selection/` + revertir los 2–3 find_replace en páginas del módulo | El editor manual no importa nada de `selection/`; cero impacto |
| 3 · Rollback de backend | Borrar `base44/functions/album-engine/` | Function nuevo sin dependientes; nada existente lo referencia |
| 4 · Rollback de datos | Borrar entidades `AlbumAnalysis*` nuevas (los datos son solo análisis; NO álbumes) | Álbumes, fotos, spreads y previews intactos |
| 5 · Limpieza total | Todo lo anterior + purgar `AlbumAISelection` | Vuelve al estado exacto de Fase 3.1 |

Garantías estructurales del rollback (derivadas de la arquitectura): ninguna entidad
nueva es requerida por el editor manual (que solo usa AlbumProject/Photo/Spread);
`album-engine` no es invocado por ningún código existente; los campos aditivos en
`AlbumPhoto` (overrides) son ignorados por todo el código de fases previas.

---

## 12. RIESGOS

| # | Riesgo | Severidad | Mitigación diseñada |
|---|---|---|---|
| R1 | Timeout/lentitud de VLM con lotes grandes | Media | Lotes ≤20 thumbs; sub-lotes E5; 120 s de timeout ya en el seam; progreso granular |
| R2 | Qwen/Base44 requieren UploadFile (subir la imagen) → contradice "nada se sube" | Alta | Verificación por proveedor ANTES de habilitarlo (Bloque 3); data URL compatible → ok; si no → proveedor marcado "requiere subida" y excluido por defecto |
| R3 | 429/rate-limit (NVIDIA ya documentado) | Media | Throttling adaptivo + failover de cadena propia + reintentos con backoff |
| R4 | Coste desbocado en catálogos grandes | Media | Cupo visible antes de ejecutar (llamadas estimadas); consentimiento por volumen; aborto entre etapas; cache por content_hash |
| R5 | Pérdida de sesión (pestaña cerrada a mitad) | Baja | Persistencia por lote + reanudación por `AlbumAISelection` (sección 8) |
| R6 | Acoplamiento accidental al core | Baja | Reglas de aislamiento auditables por checkpoint (patrón Fase 3.1: grep de imports prohibidos + regresión Core) |
| R7 | Calidad narrativa insuficiente del modelo activo | Media | Prueba de aceptación del "caso D" (foto técnica-redundante vs foto imperfecta-única) como hito del Bloque 5; comparación de informes entre proveedores |
| R8 | Payload con thumbs grandes por bug | Baja | Re-escala SIEMPRE a 256 px en el preparador de lotes (nunca se envía el thumb cacheado tal cual sin validar dimensión) |

---

## 13. LISTA EXACTA DE ARCHIVOS DE LA FASE 4.1 (propuesta por bloque)

### Nuevos — entidades (esquemas completos + RLS `created_by_id`, patrón 3.1)

```text
base44/entities/AlbumPhotoAnalysis.jsonc   (Bloque 2)
base44/entities/AlbumPhotoGroup.jsonc     (Bloque 2)
base44/entities/AlbumMoment.jsonc         (Bloque 5)
base44/entities/AlbumAISelection.jsonc    (Bloque 5)
base44/entities/AlbumAIConfig.jsonc       (Bloque 3)
base44/entities/AlbumAIFeedback.jsonc     (Bloque 6)
```

### Nuevo — backend (única pieza de backend de toda la fase)

```text
base44/functions/album-engine/entry.ts    (Bloques 3–5; actions e4…e7 + providers-test)
```

### Nuevos — frontend (módulo aislado)

```text
src/modules/album/analysis/localTechnical.js          (Bloque 1 — E2 canvas)
src/modules/album/similarity/groupBuilder.js          (Bloque 1 — E3)
src/modules/album/selection/aiPipeline.js            (Bloques 1–5 — orquestador cliente)
src/modules/album/selection/SelectionAIPage.jsx       (Bloque 1 — UI del embudo)
src/modules/album/selection/components/ConsentDialog.jsx      (Bloque 3)
src/modules/album/selection/components/FunnelView.jsx        (Bloque 1)
src/modules/album/selection/components/GroupView.jsx         (Bloque 4)
src/modules/album/selection/components/MomentTimeline.jsx     (Bloque 5)
src/modules/album/selection/components/SelectionReport.jsx  (Bloque 5 — explicaciones)
src/modules/album/selection/components/OverrideBar.jsx       (Bloque 6)
```

### Modificados (mínimos, todos dentro del módulo)

```text
src/modules/album/pages/AlbumApp.jsx          (switcher ?view=seleccion — 1 find_replace;
                                             NO se toca App.jsx ni Hub.jsx)
src/modules/album/pages/AlbumEditorPage.jsx   (badge ai_state en PhotoPanel + botón
                                             "Selección IA"; find_replaces puntuales)
src/modules/album/editor/PhotoPanel.jsx      (distintivo de estado IA por foto)
```

### Intocados (verificación de checkpoint en cada bloque)

```text
App.jsx · Hub.jsx · editflow-engine · rawAi* · aiProviderAdapter.ts (solo lectura) ·
aiGateway · entidades del core · Lightroom/plugin · editor manual (lógica)
```

---

# FIN DE LA FASE 4.0 — VALIDACIÓN TÉCNICA COMPLETADA

Sin implementación, sin backend, sin `album-engine`, sin modificar archivo alguno.
Recomendación técnica pendiente de aprobación: **opción C de proveedores**
(`invokeVision` + `forceProvider` en solo lectura, cadena y consentimiento propios del
módulo) y **orquestación en cliente** con reanudación vía `AlbumAISelection`.

# DETENIDO — ESPERANDO APROBACIÓN EXPLÍCITA PARA INICIAR FASE 4.1