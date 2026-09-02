# EDITFLOW ALBUM AI — FASE 4: DISEÑO DEL SISTEMA DE IA PARA SELECCIÓN PROFESIONAL DE FOTOGRAFÍAS
Fecha: 2026-09-02 · Estado: DISEÑO (sin implementación) · Entregable único de la fase.

**Reglas de fase (confirmadas):** NO se implementa IA, NO se crea `album-engine`, NO se
modifica backend, `editflow-engine`, Lightroom, plugin, editor manual ni sistema
existente alguno. Este documento es análisis + arquitectura + documentación.

---

## 1. FILOSOFÍA DE SELECCIÓN PROFESIONAL

### 1.1 Principio fundamental

El objetivo NO es encontrar las fotografías técnicamente mejores. El objetivo es
construir **una historia visual coherente** a partir del reportaje completo. Por tanto:

- Una foto técnicamente excelente (nitidez 98, composición 95) que **no aporta nada nuevo
  al conjunto** puede quedar fuera.
- Una foto técnicamente imperfecta (nitidez 80, composición 75) que contiene un
  **momento único, emoción o importancia narrativa** puede ser seleccionada — incluso
  prioritariamente.

Consecuencia arquitectónica central: **la decisión final nunca es una función de la foto
aislada; es una función del conjunto.** El scoring individual es solo una entrada; la
última palabra la tiene el análisis del álbum como obra completa.

### 1.2 El fotógrafo es el director

La IA ocupa el papel de un **asistente de maquetación experto**: analiza, recomienda y
explica. El fotógrafo acepta, rechaza, recupera, bloquea, marca favoritas u obliga
inclusiones. La IA nunca elimina nada: los originales son intocables (ya garantizado en
Fase 3) y las fotos "descartadas" por la IA siguen 100 % disponibles para el editor.

### 1.3 Tres verdades simultáneas

El sistema mantiene tres planos de juicio y ninguno domina solo:

```text
PLANO TÉCNICO     ¿La foto es utilizable en un álbum impreso a 300 dpi?
PLANO INDIVIDUAL  ¿La foto es buena / única / emocional por sí misma?
PLANO DEL CONJUNTO ¿Qué aporta esta foto a la historia que las otras no aportan?
```

Una foto puede brillar en dos planos y caer en el tercero: el sistema debe saber expresar
ese conflicto en la explicación (sección 8), no esconderlo en una media aritmética.

---

## 2. PIPELINE COMPLETO

Pipeline de 7 etapas. Las etapas 1–3 son **locales y gratuitas**; las 4–7 consumen IA de
forma progresiva y acotada (el embudo reduce el volumen antes de cada etapa cara).

```text
CATÁLOGO COMPLETO (N fotos)
        ↓ [E1 · local]
FINGERPRINTS + PREVIEW LISTA        (pHash, SHA-256, dims — YA EXISTE, Fase 3.1)
        ↓ [E2 · local]
PRE-FILTRADO TÉCNICO LOCAL          (nitidez/exposición/daño sobre la preview 1000px)
        ↓
VÁLIDAS (N₁ ≈ dinámico)
        ↓ [E3 · local]
AGRUPACIÓN POR SIMILITUD            (duplicados, ráfagas, variaciones de escena)
        ↓
GRUPOS (G ≈ 0,3–0,5 · N)
        ↓ [E4 · IA barata · thumbs 256px en lotes]
TRIAJE INDIVIDUAL MULTICRITERIO     (scoring multidimensional por foto)
        ↓
CANDIDATAS (N₂ ≈ 0,5–0,7 · N₁)
        ↓ [E5 · IA media · comparativa por grupo]
SELECCIÓN POR GRUPO                (mejores de cada momento/burst; el resto no se elimina)
        ↓
RECOMENDADAS (N₃)
        ↓ [E6 · IA media · descriptores textuales]
DETECCIÓN DE MOMENTOS/NODOS         (arco narrativo adaptativo)
        ↓
MOMENTOS (M ≈ 5–20)
        ↓ [E7 · IA · 1–3 llamadas con resúmenes textuales]
ANÁLISIS DEL CONJUNTO + SELECCIÓN FINAL
        ↓
SELECCIÓN FINAL (S ≈ capacidad del álbum, objetivo dinámico)
```

Propiedades del pipeline:

- **Números dinámicos**: los recortes N₁, N₂, N₃ no son porcentajes fijos; dependen del
  contenido real (una boda con muchas ráfagas agrupa más; un reportaje documental casi
  no agrupa) y del objetivo del álbum (sección 7.3).
- **Resumible e incremental**: cada etapa persiste sus resultados; re-ejecutar solo
  procesa lo no analizado (o lo marcado para re-análisis tras un cambio del fotógrafo).
- **Abortable**: el fotógrafo puede cancelar en cualquier etapa; lo completado se
  conserva.
- **Determinista en lo local, auditable en lo remoto**: E1–E3 reproducibles al 100 %;
  E4–E7 devuelven JSON estructurado que se audita y persiste.

---

## 3. ANÁLISIS MULTICRITERIO

Cada foto se analiza en **cinco dimensiones**. Las dos primeras son evalubles localmente
en gran parte; las tres últimas requieren comprensión visual (IA) y son las que aportan
el carácter "profesional".

### 3.1 CALIDAD TÉCNICA (dimensión `technical`)

Sub-criterios: `sharpness` (nitidez), `focus` (enfoque), `exposure`, `noise` (ruido),
`white_balance` (balance), `dynamic_range` (rango dinámico). 0–100 cada uno.

- **Vía principal (local, E2)**: métricas calculadas en el navegador sobre la preview de
  1000 px (ya generada en Fase 3.1): varianza de Laplaciano para nitidez, histograma para
  exposición/clip, desviación por canal para WB, ruido en zonas planas. Aproximado pero
  suficiente como **puerta de validez**, no como ranking.
- **Vía refinada (IA, E4)**: el VLM puntúa los seis sub-criterios sobre el thumbnail.
  Se fusiona con lo local (media ponderada, la IA pondera más).

Nota de diseño: la calidad técnica actúa como **umbral de usabilidad** (¿imprimible?),
no como ranking final. Una foto bajo el umbral técnico solo se salva si su valor de
momento/narrativa es alto (sección 6.3), y el sistema lo explica.

### 3.2 CALIDAD VISUAL (dimensión `aesthetic`)

Sub-criterios: `composition`, `balance`, `light`, `color`, `depth`, `impact`. 0–100.
Requiere VLM (E4). No hay sustituto local razonable; el análisis local se limita a
heurísticas gruesas (horizonte inclinado, centrado) reservadas para una fase posterior.

### 3.3 PERSONAS Y EXPRESIÓN (dimensión `people`)

Sub-criterios: `expression`, `emotion`, `gaze`, `interaction`, `naturalness`. 0–100.
**Anulable**: si la foto no contiene personas relevantes (detalles, objetos, escenas),
la dimensión es `null` y NO penaliza — simplemente no puntúa. El pipeline declara el
género del reportaje (`event_type` ya existe en AlbumProject) para activar/relajar estos
criterios (en bodas y comuniones las personas dominan; en reportaje de evento pueden no
dominar).

### 3.4 MOMENTO (dimensión `moment`)

Sub-criterios: `action` (acción), `decisive` (instante decisivo), `spontaneity`,
`uniqueness` (singularidad dentro de su grupo). 0–100. Requiere VLM comparativo dentro
del grupo (E5): el modelo ve la ráfaga junta y decide qué captura es LA captura. Este
criterio es el que más se beneficia del análisis por grupos en lugar de foto a foto.

### 3.5 VALOR NARRATIVO (dimensión `narrative`)

Sub-criterios: `scene_intro` (¿introduce una escena nueva?), `importance` (¿momento
clave: anillos, primera danza, besos, entregas?), `transition` (¿conecta dos momentos?),
`emotion_add` (¿añade emoción que otras no dan?), `variety` (¿aporta variedad al
conjunto?). 0–100.

Esta dimensión **no puede evaluarse foto a foto**: depende del contexto del reportaje.
Se evalúa en E5/E6/E7 con visibilidad creciente del conjunto (primero el grupo, luego el
momento, luego el álbum). Es la dimensión dominante de la decisión final.

---

## 4. SISTEMA DE SCORING MULTIDIMENSIONAL

### 4.1 Estructura (propuesta; nombres finales a decidir en 4.1)

```jsonc
{
  "technical":  { "sharpness": 88, "focus": 90, "exposure": 84, "noise": 79, "white_balance": 82, "dynamic_range": 77, "score": 84 },
  "aesthetic":  { "composition": 82, "balance": 80, "light": 88, "color": 85, "depth": 70, "impact": 86, "score": 83 },
  "people":     { "expression": 91, "emotion": 94, "gaze": 88, "interaction": 90, "naturalness": 85, "score": 90 },
  "moment":     { "action": 70, "decisive": 95, "spontaneity": 88, "uniqueness": 92, "score": 88 },
  "narrative":  { "scene_intro": 20, "importance": 95, "transition": 40, "emotion_add": 90, "variety": 75, "score": 76 },
  "meta": { "applicable": { "people": true }, "confidence": 0.82, "analyzed_by": "gemini-flash", "analyzed_at": "…" }
}
```

Reglas:

- **NUNCA una única puntuación global como decisión final.** Se persisten todas las
  dimensiones; la foto del álbum (`ai_scores` ya reservado en AlbumPhoto desde Fase 1)
  las muestra al fotógrafo con barras visuales.
- Los campos existentes reservados se reutilizan: `ai_scores` (dimensiones completas),
  `ai_rank` (posición dentro de su grupo), `ai_category` (tipo narrativo: "detalle",
  "retrato", "momento clave", "transición", "ambiente"), `ai_state`
  (recommended/considered/discarded/unreviewed — ampliado en la sección 9).
- `overall_score` existe SOLO como clave de ordenación por defecto en la UI, calculada
  con pesos narrativos (6.3), y siempre visible junto a sus componentes — nunca oculto.

### 4.2 Confianza

Cada análisis lleva `confidence` (0–1). Fotos con confianza baja se marcan "a revisar"
en lugar de clasificarse con contundencia. El failover entre proveedores (patrón ya
probado en el core con `aiProviderAdapter`) puede producir análisis de distinta calidad:
la confianza permite al sistema pedir confirmación humana en vez de fingir certeza.

### 4.3 Pesos por defecto (orientativos, por tipo de evento)

| Dimensión | Boda | Comunión/Bautizo | Familiar | Evento |
|---|---|---|---|---|
| technical | 15 % | 15 % | 15 % | 15 % |
| aesthetic | 20 % | 20 % | 20 % | 20 % |
| people | 20 % | 25 % | 25 % | 10 % |
| moment | 20 % | 20 % | 15 % | 25 % |
| narrative | 25 % | 20 % | 25 % | 30 % |

La ausencia de una dimensión anulable (`people: null`) re-distribuye su peso entre las
restantes, nunca penaliza.

---

## 5. DETECCIÓN DE SIMILITUD

### 5.1 Niveles de similitud (aprovechando la identidad de Fase 3.1)

| Nivel | Señal | Herramienta | Coste | Uso |
|---|---|---|---|---|
| Duplicado exacto | SHA-256 | Ya existe (`content_hash`) | 0 | Ignorar copias |
| Casi-idéntico | pHash ≤ 8 | Ya existe (`phash`) | 0 | Misma toma, misma variación |
| Ráfaga | pHash ≤ 12 + Δt < 10 s + similitud de escena | Local, E3 | 0 | Misma escena, variaciones de pose/mirada |
| Similar (distinto encuadre) | Δt < 60 s + agrupación temporal + verificación IA ligera en E4 | Local + IA | ~0 | Mismo momento, composición distinta |
| Variación de escena | mismo "momento" tras E6 | IA | — | Distintas tomas de un mismo bloque narrativo |

### 5.2 Algoritmo de agrupación (E3, local)

1. Ordenar por `capture_time`.
2. Unir por pHash estricto (≤ 8) → grupos semilla.
3. Fusionar por ventana temporal (gap configurable, por defecto 10 s) + pHash laxo (≤ 12)
   con verificación de coherencia (cadena transitiva acotada).
4. Fotos sin grupo = "singletonas" (cada una es su propio grupo).
5. Cada grupo conserva **TODAS** sus fotos (regla de fase: nada se elimina); el grupo
   elige un `representative` provisional (mejor técnico local) para las etapas de IA,
   y promociona al mejor tras E5.

### 5.3 Decisión dentro del grupo (E5)

De "20 fotos del mismo momento" la IA compara y propone las 2–3 más importantes según
momento/emoción/expresión — nunca un ranking técnico puro. El resto del grupo queda
etiquetado `group_alternative` (visible, recuperable, no recomendada). El fotógrafo
puede en cualquier momento abrir el grupo y promover una alternativa: eso es una
**decisión de aprendizaje** registrable (sección 9).

---

## 6. AGRUPACIÓN DE MOMENTOS Y SELECCIÓN NARRATIVA

### 6.1 Detección de momentos (E6)

Un "momento" es un bloque narrativo del reportaje. Detección:

1. **Local**: clustering temporal de grupos (gap configurable por tipo de evento, p. ej.
   20 min) + coherencia visual media (pHash medio entre grupos vecinos).
2. **IA (1 llamada por momento o por bloque de momentos)**: el VLM recibe los
   `representatives` de los grupos (thumbs) y propone: nombre del momento (p. ej.
   "Preparativos novia", "Entrada al salón"), tipo arquetípico y orden.

### 6.2 Plantillas adaptativas, no rígidas

Se usan **arquetipos** guiados por `event_type`, con nombre/clima emocional, sin
categorías cerradas:

- Celebración (boda/comunión/bautizo): preparativos → ceremonia → retratos → celebración
  → fiesta. El sistema NO exige que existan todos ni que sigan el orden: los detecta si
  aparecen y propone nombres propios del reportaje concreto.
- Documental (evento/familia/otro): inicio → desarrollo → momento principal → detalles →
  final.

Si el reportaje no encaja (p. ej. una sesión editorial), los momentos se construyen
libremente por coherencia visual + temporal y se nombran genéricamente hasta que el
fotógrafo los renombre. **El fotógrafo puede renombrar, fusionar, dividir y reordenar
momentos manualmente.**

### 6.3 Selección del conjunto (E7) — la etapa diferencial

Entrada: descriptores **textuales** de las candidatas finales (id, grupo, momento,
dimensiones, categoría narrativa, frase descriptiva generada en E5) — SIN imágenes:
1–3 llamadas de razonamiento puro, baratas. El modelo optimiza:

1. **Cobertura**: cada momento relevante tiene representación; ninguno domina.
2. **Ritmo**: alternancia de planos (amplios/retratos/detalles) — usa `ai_category`.
3. **Repeticiones**: penaliza candidatas cuyo aporte ya está cubierto (aquí muere la
   FOTO A "técnica pero redundante" del principio).
4. **Umbral técnico de impresión**: aplica la puerta técnica solo aquí, con la excepción
   narrativa: una foto técnicamente floja pero irrepetible se selecciona con la marca
   `tech_exception` y una explicación clara (el fotógrafo decide si la imprime).
5. **Objetivo dinámico de cantidad**: guía = `spread_count_target` × densidad deseada
   (campo ya existente en AlbumProject), con margen ±30 %. No es un límite duro: es una
   guía de calibración que la UI muestra como "has llenado 12 de ~20 spreads".

Salida: selección final +, por foto, su `selection_role` (apertura de momento, ancla
emocional, detalle de variedad, transición, cierre) — insumo directo de la futura
maquetación automática (fases posteriores).

---

## 7. SELECCIÓN EN VARIOS NIVELES (embudo dinámico)

```text
1.000 fotos → E2: 940 válidas → E3: 310 grupos → E4: 610 candidatas
           → E5: 240 recomendadas → E7: 150 seleccionadas
```

- Los recortes son **emergentes**, no fijos: dependen del agrupamiento real y del
  objetivo del álbum. Un reportaje con muchas ráfagas reducirá más en E3/E5; uno
  documental apenas agrupará.
- Cada nivel es visible y navegable para el fotógrafo: puede inspeccionar el embudo
  ("¿por qué solo 240 recomendadas?") porque cada transición deja registro (sección 8).
- Re-ejecutar es incremental: si el fotógrafo bloquea una foto o fuerza otra, solo se
  re-corre la etapa afectada (E7, y a lo sumo E6), nunca todo el pipeline.

---

## 8. EXPLICABILIDAD

### 8.1 Requisito

Toda clasificación (dentro o fuera) lleva motivos en **lenguaje claro, no técnico**,
almacenados junto al análisis y visibles en la UI (tooltip/tarjeta y panel de detalle).

### 8.2 Formato persistido

```jsonc
"reasons": {
  "included": ["Momento único", "Alta expresión emocional", "Aporta variedad al conjunto",
               "Representa una transición importante"],
  "excluded": [],
  "tech_exception": null
}
```
```jsonc
"reasons": {
  "included": [],
  "excluded": ["Similar a otras 8 fotografías del grupo (mejores alternativas ya cubren el momento)",
               "Menor impacto visual", "No aporta información narrativa adicional"],
  "tech_exception": null
}
```

### 8.3 Reglas de redacción

- Español (idioma del fotógrafo), frases cortas, sin jerga ("blur de fondo" no;
  "el fondo está suave" sí — aunque los números técnicos quedan visibles en el panel).
- Los motivos citan **causas del conjunto** cuando aplique ("redundante frente a la
  foto X del mismo momento"), porque la causa más valiosa de una exclusión narrativa es
  comparativa, no intrínseca.
- Máximo 4–5 motivos por foto: lo importante no se esconde entre ruido.

### 8.4 Explicación de embudo

Además de la foto, cada ETAPA persiste su resumen: "E3: 310 grupos (1.240 fotos
agrupadas, mayor grupo 42), E5: promocionadas 2-3 por grupo según emoción…". El
fotógrafo ve el porqué global, no solo el porqué por foto.

---

## 9. CONTROL DEL FOTÓGRAFO

### 9.1 Modelo de decisión final (futuro campo conceptual `override`)

```text
IA ANALIZA → IA RECOMIENDA → IA EXPLICA → EL FOTÓGRAFO DECIDE
```

Estados/acciones del fotógrafo sobre cada foto (conceptuales; se materializarían como
campos aditivos en Fase 4.1 siguiendo el precedente de la Fase 3.1):

| Acción | Efecto | Notas |
|---|---|---|
| Aceptar recomendación | `ai_state: recommended` confirmado | — |
| Rechazar | `override: blocked` | La IA NO puede volver a seleccionarla en re-runs; recuperable |
| Recuperar (estaba descartada por IA) | `override: promoted` | Entra como seleccionada aunque la IA no la recomendara |
| Obligar a incluir | `override: pinned` | Inmune a cualquier re-análisis y a la puerta técnica |
| Marcar favorita | `favorite: true` | Señal de aprendizaje (sección 9.3) + prioridad en embudo |
| Descartar grupo | rechaza representante + alternativas | Atajo sobre el grupo completo |

### 9.2 Jerarquía de inmunidad

```text
pinned > promoted/blocked (override humano) > selección IA > no recomendada > válida
```

Toda re-ejecución respeta los overrides: la IA puede reordenar lo libre, nunca lo
decidido por el fotógrafo. El estado existente `ai_state` y los reservados
`ai_rank/ai_scores/ai_category` se reutilizan; los overrides serían aditivos.

### 9.3 Preparación del aprendizaje futuro (NO implementar)

Cada override es un dato de entrenamiento potencial. Se registra (conceptualmente, en
`AlbumAIFeedback`, sección 13) sin procesarlo todavía:

```text
IA RECOMIENDA → FOTÓGRAFO CAMBIA → SISTEMA REGISTRA DECISIÓN → (futuro) PATRONES
→ MEJORES RECOMENDACIONES
```

Lo que se prepara desde ya (a nivel de diseño de datos): capturar el contexto de la
decisión (dimensiones de la foto, alternativas del grupo, motivo si el fotógrafo lo
escribe, momento, tipo de evento, proveedor/versión del análisis). El aprendizaje real
(ajuste de pesos, preferencias por fotógrafo) se decide en una fase posterior con esos
datos ya acumulados. **No se implementa nada de esto ahora.**

---

## 10. ARQUITECTURA IA — COMPARATIVA DE OPCIONES

Restricción estructural clave: **las previews viven en IndexedDB del navegador** (fase
3.1); el backend no puede leerlas. Cualquier análisis remoto lo orquesta el cliente, que
envía la preview elegida (thumb 256 o preview 1000) al proveedor vía un backend function
que actúa como proxy con failover. Este patrón ya está probado en EditFlow Core
(`rawAiSmartSelect` + `aiProviderAdapter`), pero `album-engine` será un function NUEVO
y aislado: no se reutiliza `editflow-engine` ni se modifica nada existente.

### OPCIÓN A — Análisis local (todo en el navegador / WebGPU)

| Criterio | Evaluación |
|---|---|
| Coste | ✅ Cero llamadas |
| Velocidad | ⚠️ Depende del hardware; modelos locales VLM pequeños aún lentos/imprecisos |
| Privacidad | ✅ Máxima (nada sale) |
| Calidad | ❌ Los modelos locales actuales NO comprenden "valor narrativo", emoción o instante decisivo con fiabilidad profesional |
| Escalabilidad | ⚠️ Limitada por RAM/GPU del equipo del fotógrafo |
| Compatibilidad | ⚠️ Empaquetar modelos en la app móvil/web es complejo y pesado |

**Veredicto**: viable SOLO para E2 (técnico local, ya contemplado). Insuficiente para el
objetivo de esta fase: la narrativa exige comprensión visual profunda.

### OPCIÓN B — IA 100 % mediante API

| Criterio | Evaluación |
|---|---|
| Coste | ❌ Analizar TODO el catálogo remoto es caro e innecesario (muchas fotos de la misma ráfaga) |
| Velocidad | ⚠️ Buena por lote, pero sujeta a red y a límites del proveedor |
| Privacidad | ❌ Todas las previews salen del dispositivo |
| Calidad | ✅ Máxima comprensión narrativa/emocional |
| Escalabilidad | ✅ Alta |
| Compatibilidad | ✅ Patron ya probado en EditFlow (proveedores con failover) |

**Veredicto**: calidad suficiente, pero coste y privacidad subóptimos si se aplica a ciegas
a todo el catálogo.

### OPCIÓN C — HÍBRIDO: análisis local + IA remota progresiva ⭐ RECOMENDADA

| Criterio | Evaluación |
|---|---|
| Coste | ✅ El embudo hace que la IA solo vea: thumbs de candidatas y representatives; ~0,3–0,5 llamadas efectivas por foto del catálogo |
| Velocidad | ✅ E1–E3 instantáneos y sin red; E4–E7 por lotes |
| Privacidad | ✅ Solo sale la preview reducida indicada (256/1000 px), nunca el original, y con consentimiento explícito por ejecución |
| Calidad | ✅ Igual que B en las etapas que importan (4–7) |
| Escalabilidad | ✅ El catálogo puede crecer sin crecer proporcionalmente el coste (agrupa antes de gastar) |
| Compatibilidad | ✅ Encaja con la arquitectura local-first ya aprobada y con proveedores con failover existentes |

**Justificación de la recomendación (no decisión definitiva — queda pendiente de
aprobación)**: C domina porque el problema real del coste no es "cuánto cuesta una
llamada" sino "cuántas fotos NO necesitan llamadas": duplicados, ráfagas y fotos
técnicamente inválidas se resuelven gratis con la identidad de Fase 3.1 (pHash/SHA-256)
y el pre-filtrado local. Además C degrada con elegancia: sin conexión/proveedor, E1–E3
siguen funcionando y el fotógrafo trabaja con agrupaciones y técnica local mientras la
parte narrativa queda pendiente.

### 10.1 Proveedores y failover

`album-engine` (futuro) reutilizaría el **patrón** de `aiProviderAdapter` (Qwen, Gemini,
NVIDIA, Base44, custom OpenAI-compatible; failover automático ya exigido por las
preferencias del proyecto), pero con **configuración propia del módulo album** (no la
entidad admin `AiProviderConfig` del core): la selección de álbumes es una herramienta
de fotógrafo, no un ajuste global de plataforma. Los proveedores no disponibles se
muestran en gris (preferencia ya establecida del proyecto). Versión/modelo del análisis
se persiste con cada resultado para auditoría y para el aprendizaje futuro.

---

## 11. PREVIEWS Y PRIVACIDAD — QUÉ PUEDE SALIR DEL DISPOSITIVO

**Regla dura (heredada y mantenida): los originales NUNCA se suben automáticamente.**
Tampoco manualmente: no existe flujo de subida de originales en el módulo (fase 3
auditada: solo lectura, cero escritura, cero subida).

Qué saldría, exactamente, en cada etapa — y con qué consentimiento:

| Etapa | Qué se envía | Formato | Cuándo | Consentimiento |
|---|---|---|---|---|
| E1–E3 | **NADA** | — | — | No requerido |
| E4 | Thumb 256 px (JPEG q0.72, re-codificado) | data URL en lote (~20/lote) | Al ejecutar la selección IA | Explícito por ejecución, con resumen del volumen |
| E5 | Thumb/preview 256–1000 px del GRUPO | data URL por grupo | Ídem | Ídem |
| E6 | Thumbs de representatives de momento | data URL | Ídem | Ídem |
| E7 | **Solo texto** (descriptores) | JSON | Ídem | Ídem |

Metadatos enviados: `capture_time`, `orientation`, dimensiones. **NO** se envían rutas
de archivo, `relative_path` ni `filename` completo (se envía un alias corto) — el
árbol de carpetas del fotógrafo no sale del equipo. `content_hash`/`phash` tampoco
viajan (identidad interna, innecesaria para el análisis).

Alternativa embeddings (evaluada para fase posterior): generar embeddings de las
previews con un modelo de visión y comparar similitud en ese espacio. Ventaja: los
embeddings (vectores ~512 floats, SIN imagen) podrían persistirse y sustituir parte de
las comparaciones de E5. Desventaja: sigue requiriendo subir la preview una vez para
embedearla, y los VLM de razonamiento siguen haciendo falta para narrativa. Se deja
documentado como optimización opcional de la E5 masiva; **no** forma parte del plan
inmediato.

---

## 12. COSTE Y CONSUMO DE IA

Supuestos de modelo de llamadas (opción C):

```text
Llamadas ≈ (N₁/20)  [E4 lotes de thumbs]
         + G        [E5 una por grupo]
         + M        [E6 una por momento]
         + ~3       [E7 conjunto]
Con G ≈ 0,3–0,5·N₁ grupos y M ≈ 5–20 momentos.
```

### Comparativa de estrategias

| Estrategia | Llamadas (N=1.000) | Coste relativo | Comentario |
|---|---|---|---|
| Analizar TODO con IA | ~1.000+ | ❌ Máximo | Paga por 42 fotos de la misma ráfaga |
| Pre-filtrado local SOLO | 0 | ✅ Cero | No resuelve narrativa — insuficiente |
| **Híbrido con embudo (propuesto)** | **~400–550** | ✅ Bajo | IA solo donde aporta valor |
| Análisis progresivo manual (el fotógrafo lanza etapa a etapa) | ~ídem, repartido | ✅ Bajo + control total | Ya contemplado: el pipeline es resumible |
| Embeddings + IA solo final | ~350–450 | ✅ Bajo | Complejo; diferido (sección 11) |

### Proyección orientativa (híbrido; coste RELATIVO — precio real depende del proveedor
elegido y su tarifa por imagen/mensaje; los VLM tipo "flash" son órdenes de magnitud
más baratos que los "pro"):

| Catálogo | Grupos est. | Llamadas est. | Previews enviadas | Imagen subida |
|---|---|---|---|---|
| 100 fotos | ~40 | ~50 | ~80 thumbs | ≤ 2 MB total aprox. |
| 500 fotos | ~180 | ~210 | ~300 | ≤ 8 MB |
| 1.000 fotos | ~350 | ~410 | ~550 | ≤ 15 MB |
| 2.000 fotos | ~700 | ~810 | ~1.100 | ≤ 30 MB |

Ahorro clave frente a "analizar todo": **50–60 % menos llamadas** con idéntica calidad
de decisión final, porque la redundancia se elimina antes de gastar (E3) y la etapa
final (E7) no usa imágenes. El margen de mejora adicional (embeddings) queda documentado
para fases futuras.

Estrategias anti-coste adicionales de diseño:

- **No re-analizar sin motivo**: resultados persistidos por foto; re-runs incrementales.
- **Cache por content_hash**: si la misma foto (hash idéntico) ya fue analizada en otro
  álbum del mismo usuario, se reutiliza el análisis individual (E4) — el contexto
  narrativo (E5–E7) sí es siempre específico del álbum.
- **Cupo visible**: la UI informa antes de ejecutar ("~410 llamadas estimadas") y
  permite abortar entre etapas. Alineado con la preferencia de costes controlados del
  proyecto (créditos ya identificados como limitación en el core).

---

## 13. MODELO DE DATOS FUTURO (SOLO CONCEPTUAL — NO CREAR ENTIDADES)

Cinco estructuras futuras, todas con prefijo `Album`, todas con RLS por
`created_by_id` (patrón idéntico a las entidades de fase 1–3), todas **aditivas**.

### 13.1 `AlbumPhotoAnalysis`

- **Responsabilidad**: resultado del análisis INDIVIDUAL de una foto (E2–E4) y su
  explicación. 1 : N con AlbumPhoto (1 análisis vigente por foto y versión).
- **Datos**: photo_id, project_id, dimensiones completas (sección 4), reasons,
  confidence, provider, model, analysis_version, status
  (local_done/triage_done/failed), cacheado de content_hash para reutilización.
- **Relaciones**: N:1 AlbumPhoto; N:1 AlbumPhotoGroup.

### 13.2 `AlbumPhotoGroup`

- **Responsabilidad**: grupo de similitud de E3 (duplicados, ráfaga, variación de
  escena) + resultado de la decisión de grupo de E5.
- **Datos**: project_id, kind (duplicate/burst/scene_variation/singleton),
  photo_ids[], representative_photo_id, promoted_photo_ids[], group_score_summary,
  e5_reasoning (texto breve), ai_version.
- **Relaciones**: 1:N AlbumPhoto (por lista de ids); N:1 AlbumMoment.
- **Nota de diseño**: guardar `photo_ids` como lista (no join real) mantiene el módulo
  simple y consistente con los `slots` ya resueltos como datos.

### 13.3 `AlbumMoment`

- **Responsabilidad**: bloque narrativo detectado en E6 (o editado por el fotógrafo).
- **Datos**: project_id, name (editable), archetype (preparativos/ceremonia/.../libre),
  order_index, group_ids[], photo_count, summary (1 frase), locked (el fotógrafo puede
  fijar su estructura).
- **Relaciones**: 1:N AlbumPhotoGroup; N:1 AlbumProject.

### 13.4 `AlbumAISelection`

- **Responsabilidad**: UNA ejecución completa del pipeline (un "informe de selección"):
  embudo con números de cada etapa, selección final con roles narrativos, estado del
  job y snapshot de configuración (proveedor, pesos, objetivo de cantidad).
- **Datos**: project_id, status (queued/running/stage_n/completed/failed/canceled),
  stage_progress {e2:…, e7:…}, funnel_counts {valid, candidates, recommended, selected},
  provider, model, cost_estimate, selection[] {photo_id, role, reasons, tech_exception},
  created_by, created_date.
- **Relaciones**: N:1 AlbumProject; referencia (por id) a AlbumPhotoAnalysis/Group/Moment.
- **Ventaja de separarlo de la foto**: las re-ejecuciones no machacan el histórico —
  el fotógrafo puede comparar dos selecciones IA distintas, y el aprendizaje futuro
  tiene el registro de qué recomendó cada versión.

### 13.5 `AlbumAIFeedback`

- **Responsabilidad**: registrar decisiones del fotógrafo (overrides) con su contexto,
  para el APRENDIZAJE FUTURO (fase posterior, no ahora).
- **Datos**: project_id, selection_id (qué selección IA motivó la decisión), photo_id,
  action (accept/reject/promote/pin/favorite/unblock), context_snapshot (dimensiones de
  la foto, alternativas del grupo, momento, event_type, analysis_version), note opcional.
- **Relaciones**: N:1 AlbumAISelection; N:1 AlbumPhoto.

Nada de esto se crea ahora. En Fase 4.1 se crearían con `write_file` sobre
`base44/entities/*.jsonc` como en Fase 1/3.1 (esquema completo, aditivo, RLS por usuario).

---

## 14. DISEÑO CONCEPTUAL DE `album-engine` (NO CREARLO)

### 14.1 Responsabilidades

Backend function nuevo y aislado (`base44/functions/album-engine/entry.ts`), función
úNICA de proxy-orquestador de IA del módulo album:

- Recibir lotes EMBEDDOS (data URLs) del cliente y enrutarlos al proveedor configurado
  del módulo (Qwen/Gemini/NVIDIA/Base44/custom) con **failover automático** (preferencia
  de proyecto ya establecida: si un proveedor falla, se intenta el siguiente).
- Normalizar respuestas JSON a los esquemas de E4–E7 (sección 4) con validación estricta.
- Persistir versión/modelo/proveedor de cada análisis para auditoría y aprendizaje futuro.
- NUNCA: tocar entidades del core, tocar `editflow-engine`, almacenar imágenes (los
  data URLs se procesan en memoria y se descartan; no se persiste pixel alguno).

### 14.2 Contrato (conceptual)

```text
POST action:"e4-triage"    { projectId, batch: [{ alias, thumb } …20], event_type }
          → [{ alias, dims, confidence, provider }]
POST action:"e5-group"    { projectId, group: { thumbs[], capture_times[] } }
          → { promoted[], rationale, per_photo: dims+reasons }
POST action:"e6-moments"   { projectId, representatives[] }
          → { moments: [{ name, archetype, group_refs }] }
POST action:"e7-assembly" { projectId, descriptors[] (SOLO TEXTO), album_target }
          → { selection: [{photo_id, role, reasons, tech_exception}], coverage_report }
POST action:"providers-test" {…}   → diagnóstico de conectividad (patrón del core)
```

### 14.3 Jobs y estados

La ejecución del pipeline NO es un job de backend duradero: **la orquestación vive en el
cliente** (el navegador tiene las previews y controla abort/reanudación), y
`AlbumAISelection.status` (sección 13.4) es el registro duradero del progreso:

```text
queued → running(e2…e7 con stage_progress) → completed | failed(etapa, reintentable) | canceled
```

Reanudar = re-ejecutar desde la última etapa completada usando los análisis persistidos.
Esto evita crear workflows/actors nuevos y mantiene el 100 % de la lógica en el módulo
album (el backend solo ve lotes sin estado).

### 14.4 Integración futura (si se aprueba)

- Invocación desde el módulo album vía `base44.functions.invoke("album-engine", {…})`.
- Aislamiento: `album-engine` no importa `editflow-engine`; puede importar módulos
  `base44/shared/` de solo lectura (p. ej. reutilizar el patrón de adaptador de
  proveedores) SIN modificarlos, o contener su propia copia si se prefiere aislamiento
  absoluto (decisión de Fase 4.1, se recomienda reutilizar `base44/shared/aiProviderAdapter.ts`
  como dependencia de solo lectura para no duplicar la lógica de failover ya probada).
- Rollback total: borrar el function = cero impacto en cualquier otro sistema.

---

## 15. PLAN DETALLADO DE FASE 4.1 (PROPUESTA — PENDIENTE DE APROBACIÓN)

Criterio de orden: **valor antes que coste, aislamiento siempre, rollback siempre**.

### Bloque 1 — Capa local (E2+E3) — SIN IA, SIN BACKEND, SIN COSTE
1. Qué se implementaría: análisis técnico local sobre previews 1000 px (nitidez,
   exposición, ruido, WB, rango) y clustering de similitud con pHash/Δt existentes,
   con UI del embudo (grupos visibles, navegable, sin recomendaciones aún).
2. Local: 100 %. 3. IA externa: nada. 4. Backend: nada.
5. Aislamiento: solo `src/modules/album/` (nuevos `analysis/` y `similarity/`).
6. Rollback: borrar archivos nuevos; cero persistencia nueva si aún no hay entidades.
7. Pruebas: checkpoints con fotos reales en navegador + réplica lógica (patrón fase
   3.1) + Testing Agent ("importar carpeta, abrir Selección IA, ver grupos correctos").

### Bloque 2 — Modelo de datos de análisis
1. Entidades aditivas `AlbumPhotoAnalysis` + `AlbumPhotoGroup` (+persistencia de E2–E3).
2. Local: sí. 3. IA: no. 4. Backend: no (SDK directo desde cliente).
5. Aislamiento: entidades Album* nuevas; esquema AlbumPhoto solo aditivo si hiciera
   falta un puntero de caché (precedente aprobado en 3.1).
6. Rollback: eliminar entidades nuevas (sin datos preexistentes).
7. Pruebas: roundtrip + RLS (checkpoint estilo 3.1) + regresión Core.

### Bloque 3 — `album-engine` (proxy de proveedores + lotes E4)
1. Function nuevo con acciones `e4-triage` y `providers-test`, failover, validación.
2. Local: orquestación cliente. 3. IA externa: SÍ (primera vez; thumbs 256 en lotes).
4. Backend: el function nuevo (única pieza de backend de toda la fase).
5. Aislamiento: function independiente; `editflow-engine` intocado.
6. Rollback: delete del function; flag por proyecto en la UI para desactivar la parte IA.
7. Pruebas: `test_backend_function` con lotes sintéticos; medición de llamadas vs
   estimación de la sección 12; prueba de failover (proveedor primario caído).

### Bloque 4 — E5 (decisión por grupo) + explicabilidad
1. Acción `e5-group`, UI de grupos con motivos por foto, promoción manual de
   alternativas. 2–7. Análogos al Bloque 3 (mismo rollback por function + flag).

### Bloque 5 — E6+E7 (momentos + selección narrativa) + `AlbumAISelection`
1. Detección de momentos, ensamblado del conjunto con roles y explicaciones, informe
   del embudo completo. UI "Selección IA" dentro del módulo album (pestaña propia).
2. Resto igual. 7. Pruebas: caso D de selección (foto técnica pero redundante fuera,
   foto imperfecta pero única dentro) sobre fixtures diseñados — la prueba de
   aceptación de toda la fase.

### Bloque 6 — Overrides del fotógrafo + `AlbumAIFeedback` (registro, sin aprendizaje)
1. Estados y jerarquía de la sección 9 + registro de decisiones (datos guardados,
   cero procesamiento). Es la semilla del aprendizaje futuro, desactivada.

### Qué NO entra en 4.1
Aprendizaje real (fase posterior, con datos ya acumulados), embeddings, ajuste de pesos
por fotógrafo, integración con maquetación automática de spreads, IA de layouts.

### Presupuesto de coste de 4.1
Bloques 1–2 y 6: coste cero. Bloques 3–5: el consumo de la sección 12, acotado por el
embudo y con cupo visible en la UI antes de cada ejecución.

---

## DECISIÓN FINAL DE LA FASE 4

**FIN DEL DISEÑO — SIN IMPLEMENTACIÓN.** No se ha creado código, backend,
`album-engine`, entidades, ni se ha modificado sistema alguno (único artefacto: este
documento). Recomendación técnica pendiente de aprobación: **opción C (híbrido)** con
embudo progresivo, scoring multidimensional narrativo-ponderado y explicabilidad total.

# DETENIDO — ESPERANDO APROBACIÓN EXPLÍCITA PARA INICIAR FASE 4.1