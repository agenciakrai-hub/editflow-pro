# EDITFLOW ALBUM AI — FASE 4.0.1: VALIDACIÓN DE PRIVACIDAD Y TRANSPORTE DE IMÁGENES
Fecha: 2026-09-02 · Fase exclusivamente de INVESTIGACIÓN + VALIDACIÓN + DOCUMENTACIÓN.
**No se ha implementado nada, ni creado `album-engine`, ni enviado fotografía alguna
(real o sintética), ni modificado archivo o configuración.** Las verificaciones de esta
fase provienen de: (a) lectura del código real del adaptador (`aiProviderAdapter.ts`),
(b) documentación oficial de los proveedores (Alibaba Cloud Model Studio, Google AI
Terms/ZDR), y (c) la arquitectura de previews ya auditada en Fase 3.1. Cualquier prueba
de transportE en vivo queda aplazada al Bloque 3 de 4.1 con imagen sintética.

---

## 1. PROVEEDORES REVISADOS (los realmente contemplados en la arquitectura)

Contemplados hoy (secrets verificados existentes): **Gemini** (dos keys:
`GEMINI_API_KEY` y `GEMINI_API_KEY_PAID`), **Qwen/DashScope** (`QWEN_API_KEY`),
**NVIDIA NIM** (`NVIDIA_API_KEY`), **proveedores custom OpenAI-compatibles**
(entidad `CustomAiProvider`) y **Base44 InvokeLLM** (créditos de integración).
Todos acceden hoy por el mismo seam (`invokeVision`), leído íntegro en Fase 4.0.

---

## 2. MÉTODO REAL DE TRANSPORTE (verificado en el código, no asumido)

| Proveedor | Ruta de transporte real | Envío de imagen |
|---|---|---|
| Gemini | `POST /models/<m>:generateContent` con `inline_data` | ✅ **data URL → base64 inline**, sin subida (verificado: `callGeminiOnce` parsea `data:...;base64,`) |
| NVIDIA NIM | `POST /chat/completions` OpenAI-compat | ✅ **data URL directa** en `image_url` (verificado: comentado y usado así en el adaptador) |
| Custom | `POST /chat/completions` OpenAI-compat | ✅ el adaptador envía **data URL directa**; la aceptación depende del endpoint dueño |
| Qwen/DashScope | `POST /compatible-mode/v1/chat/completions` | ✅ **VERIFICADO en documentación oficial de Alibaba Cloud**: `image_url: { url: "data:image/jpeg;base64,..." }` es un método documentado ("Pass a local file (Base64 encoding)"). La ruta UploadFile que usa hoy el core es UNA opción, no la única. Límite documentado: imágenes >7 MB requieren URL pública — nuestras previews (~30 KB) quedan muy por debajo |
| Base44 InvokeLLM | `InvokeLLM({ file_urls })` | ❌ requiere **URL http** — en el core se genera con `UploadFile`, que SUBE la imagen al almacenamiento de la app |

---

## 3. DATA URL — VERIFICACIÓN ESPECÍFICA (sin UploadFile)

Conclusión verificada: **Gemini, NVIDIA, Qwen y custom pueden recibir la imagen como
data URL (base64 inline) SIN UploadFile ni almacenamiento intermedio.** El único
proveedor que no puede es Base44 InvokeLLM (su parámetro `file_urls` exige URLs ya
subidas). Esto valida el principio de la Fase 4.0: la cadena por defecto de Album AI
puede funcionar 100 % inline, sin que ninguna miniatura se almacene en la plataforma ni
en ningún bucket.

**Prueba técnica aplazada (regla de fase cumplida)**: ninguna fotografía real ha sido
enviada. En el Bloque 3 de 4.1, `providers-test` de `album-engine` verificará con UNA
imagen sintética (canvas generado, sin datos privados) por proveedor: aceptación del
data URL, latencia y tamaño, antes de habilitarlo en la cadena del módulo.

---

## 4. UPLOADFILE — ANÁLISIS (para el único proveedor que lo requiere)

| Pregunta | Respuesta verificada |
|---|---|
| ¿Dónde se sube? | `UploadFile` sube al **directorio de archivos del usuario en la plataforma Base44** (URLs servidas desde el almacenamiento de la app) |
| ¿Existe almacenamiento? | Sí: la preview queda almacenada como archivo de la app, con URL accesible |
| ¿Duración de retención? | **Sin TTL documentado**: no existe borrado automático ni caducidad |
| ¿Puede eliminarse inmediatamente? | No existe una operación de borrado expuesta en la integración |
| ¿Procesamiento temporal? | El análisis es temporales, pero el ARCHIVO subido es persistente |
| Riesgo de privacidad | **ALTO para la regla de esta fase**: cada preview enviada por esta ruta quedaría almacenada durante un periodo NO controlable |

**Aplicación de la regla de fase**: Base44 InvokeLLM queda
**`NO APTO PARA ALBUM AI` hasta decisión posterior** — no entra en la cadena por
defecto del módulo. (Nota: es además el proveedor con la limitación de créditos ya
documentada en el proyecto.)

---

## 5. ALMACENAMIENTO Y RETENCIÓN POR PROVEEDOR

- **Gemini (términos verificados — Google AI / Gemini API Additional Terms + ZDR)**:
  dos niveles documentados por Google:
  - **Paid Services** (API de pago): "Google no usa tus prompts —incluidas imágenes y
    system instructions— para mejorar sus productos"; confidencial bajo el acuerdo de
    procesamiento de Google Cloud; existe Zero Data Retention documentado. ✅
  - **Tier gratuito (AI Studio)**: Google puede usar los datos para mejorar sus
    productos. ⚠️ Matiz CRÍTICO verificado en el código: `callGemini` del adaptador lee
    `GEMINI_API_KEY` (la key del tier gratuito). La key de pago
    (`GEMINI_API_KEY_PAID`) existe como secret pero **el adaptador no la usa**. Para
    Album AI esto obliga a decidir en 4.1 (sección 11): o (a) mini-transporte propio de
    Gemini dentro de `album-engine` que lea la key de pago (~60 líneas, aislado), o
    (b) aceptar el tier gratuito con consentimiento explícito al usuario.
- **Qwen/DashScope**: el procesamiento por API es sin almacenamiento persistente
  documentado para el modo compatible; la retención específica de entradas no queda
  verificada al 100 % en fuentes oficiales consultadas → condicionado (sección 9).
- **NVIDIA NIM (build.nvidia.com)**: data URL verificado en código; la política de
  retención de entradas no ha podido verificarse de fuente primaria concluyente en esta
  fase → condicionado + riesgo operativo documentado (HTTP 429, ya sufrido en el core).
- **Custom**: retención y privacidad = responsabilidad del dueño del endpoint →
  verificación obligatoria al registrar el proveedor.

---

## 6. SANITIZACIÓN — FLUJO EXACTO DE LO QUE SALE DEL DISPOSITIVO

```text
INPUT ORIGINAL (JPEG exportado por Lightroom, en disco del fotógrafo)
        ↓ NUNCA se mueve: File System Access API en modo lectura
PREVIEW GENERADA LOCALMENTE (canvas del navegador, Fase 3.1)
        ↓ makePreviews decodifica el píxel y RE-CODIFICA
SANITIZACIÓN (garantizada por el pipeline ya implementado)
        ↓
DATOS ENVIADOS (data URL inline, sin metadatos, sin rutas, sin hashes)
```

Verificación clave del código propio: **la re-codificación por canvas (`toDataURL`)
produce un JPEG nuevo SOLO con datos de píxel**. EXIF (cámara, fecha, autor), GPS y
cualquier metadato del archivo original NO se copian: la salida es una imagen limpia.
Por tanto toda imagen enviada a IA es, por construcción:

- ✅ Sin EXIF (cámara/lente/autor eliminados).
- ✅ Sin geolocalización (el GPS vive en EXIF: eliminado).
- ✅ Sin metadatos de ninguna clase (solo píxeles).
- ✅ Sin rutas locales, sin `filename`, sin `relative_path` (el lote usa alias `p17`).
- ✅ Sin `content_hash`/`phash` (identidad interna: no viaja).
- ✅ Con orientación de píxeles correcta (el navegador aplica la orientación EXIF al
  decodificar ANTES de que el EXIF se pierda; verificado en el flujo de previews).

Refuerzo de diseño para 4.1: el preparador de lotes RE-VALIDARÁ dimensiones y peso de
cada imagen antes de enviarla (defensa en profundidad ante cualquier caché antigua):
máximo 512 px y 100 KB por imagen de análisis; si excede, se re-escala antes de salir.

---

## 7. PREVIEW PROPUESTA (definición justificada — NO implementada)

| Parámetro | Propuesta | Justificación técnica |
|---|---|---|
| Resolución de análisis (E4/E5/E6) | **512 px borde mayor** | 256 px (diseño F4) puede perder expresión facial en fotos de grupo; 512 px conserva emoción/mirada legible para un VLM a un coste mínimo. El diseño original de 256 px queda subsumido: el thumb 256 existente sigue para UI; para IA se genera una variante 512 desde la preview 1000 local |
| Calidad JPEG | **q0.75** | Suficiente para análisis visual; q mayor no mejora la comprensión del modelo y encoge el lote (mejor latencia y menos tokens de imagen) |
| Peso esperado | **40–80 KB por imagen** | Lote E4 de 20 ≈ 0,8–1,6 MB de payload — muy dentro de límites razonables |
| Resorte de confirmación (E5 retratos, opcional) | 1000 px q0.82 (≈150–400 KB), **OFF por defecto** | Solo si el fotógrafo activa "confirmación en alta" — requiere consentimiento específico por volumen |
| Límites duros (no superables nunca) | **1024 px · 500 KB · JPEG q ≤ 0.85** | Techo absoluto del sistema de lotes, validado en el preparador antes de cada envío |
| Formato | **JPEG** (re-codificado, sin EXIF) | Compatible inline con los 4 proveedores aptos (PNG aceptado también por Qwen/Gemini, pero JPEG es el óptimo peso/calidad) |

Nunca (confirmado, arquitectura verificada): RAW — el módulo ni lo acepta como
entrada; TIFF — no soportado por el registro de formatos; JPEG original — no existe
flujo de subida de originales en el módulo.

---

## 8. CONSENTIMIENTO (definición exacta — UI NO implementada)

Texto conceptual que verá el fotógrafo antes de cada análisis remoto:

```text
ESTE ANÁLISIS UTILIZA IA REMOTA.

SE ENVIARÁN PREVIEWS REDUCIDAS (512 px, SIN DATOS EXIF NI UBICACIÓN)
DE ALGUNAS FOTOGRAFÍAS AL PROVEEDOR: <nombre proveedor>.

LOS ARCHIVOS ORIGINALES NUNCA SE ENVIARÁN.

Volumen estimado: ~X miniaturas (~Y MB) en ~Z llamadas.
Proveedor alternativo si falla: <cadena>.
Puedes cancelar en cualquier momento y reanudar donde lo dejaste.
```

- **Consentimiento puntual (por defecto)**: por ejecución de pipeline. Cada ejecución
  es un `AlbumAISelection` que registra texto aceptado, fecha, proveedor y volumen.
- **Consentimiento permanente (opcional)**: guardable en `AlbumAIConfig`
  (`consent_mode: saved`) → confirmación ligera en ejecuciones siguientes, mismo texto
  de resumen visible. Siempre revocable.
- **Revocación**: un clic en la configuración del módulo (poner `per_run` o vaciar
  `allowed_providers`). Efectos tras revocar: (1) ninguna nueva llamada sale sin
  consentimiento puntual; (2) los análisis YA realizados no se borran solos — se
  ofrecen las acciones "conservar" o "purgar informes"; (3) la ejecución en curso se
  detiene en el siguiente lote (cancellable), conservando lo persistido.

---

## 9. MATRIZ DE PROVEEDORES (resultado de la validación)

| Proveedor | Data URL | Upload | Retención conocida | Riesgo | Estado |
|---|---|---|---|---|---|
| **Gemini — tier PAGO** (`GEMINI_API_KEY_PAID`) | ✅ verificado (inline_data) | No necesario | ✅ No usa datos para entrenar (Paid Services, términos verificados); ZDR documentado | Bajo | **APTO** — con condición de implementación: requiere mini-transporte propio que lea la key de pago (adaptador actual solo usa la key free) |
| **Gemini — tier FREE** (`GEMINI_API_KEY`, la que usaría hoy `forceProvider`) | ✅ verificado | No necesario | ⚠️ Google puede usar datos para mejorar productos (términos del tier gratuito) | Medio | **APTO CON CONDICIONES** — solo con consentimiento explícito que informe de este matiz |
| **Qwen / DashScope** | ✅ verificado (docs oficiales: base64 en `image_url`) | No necesario (evitable) | ⚠️ Retención de entradas no verificada al 100 % en fuentes consultadas | Medio | **APTO CON CONDICIONES** — incluir solo tras `providers-test` sintético + revisión de ToS vigente |
| **NVIDIA NIM** | ✅ verificado (adaptador) | No necesario | ⚠️ No verificada de fuente primaria concluyente | Medio + 429 operativo documentado | **APTO CON CONDICIONES** — mismo requisito de prueba; excluido como principal por inestabilidad ya sufrida |
| **Custom OpenAI-compat** | ✅ (el adaptador envía data URL) | No necesario | Depende 100 % del dueño del endpoint | Variable | **APTO CON CONDICIONES** — `providers-test` obligatorio al registrarlo + consentimiento que nombre al proveedor |
| **Base44 InvokeLLM** | ❌ requiere URL subida | ✅ UploadFile → almacenamiento de la app SIN TTL ni borrado expuesto | ❌ Persistencia no controlable | Alto (viola la regla de fase) | **NO APTO PARA ALBUM AI** — hasta decisión posterior |

---

## 10. RIESGOS RESIDUALES

| # | Riesgo | Mitigación diseñada |
|---|---|---|
| P1 | Un proveedor apto cambia sus términos de retención en el futuro | Consentimiento muestra SIEMPRE el nombre del proveedor; matriz re-auditable; cadena configurable por usuario |
| P2 | Gemini: usar `forceProvider` hoy implicaría la key FREE (adaptador lee `GEMINI_API_KEY`) | Decisión de 4.1: mini-transporte Gemini (60 líneas) en `album-engine` con la key de pago — aislado, sin tocar el adaptador compartido |
| P3 | ToS de Qwen/NVIDIA no verificados al 100 % en esta fase | Solo entran tras `providers-test` sintético + verificación de ToS vigente; hasta entonces PENDIENTE de activación aunque el transporte sea apto |
| P4 | Envío accidental de una imagen mayor de lo definido | Re-validación dura (512 px / 100 KB) en el preparador de lotes antes de CADA envío |
| P5 | Retención por parte del proveedor durante el procesamiento | Innegable en cualquier API (la imagen debe residir en memoria del servicio durante la inferencia); mitigado al mínimo: solo previews sanitizadas, lotes pequeños, sin identificadores |
| P6 | Confusión usuario "la IA ve mis álbumes" | Texto de consentimiento literal con volúmenes y límites; embudo visible; nada sale en E1–E3 |

---

## 11. RECOMENDACIÓN (sin selección automática — decisión pendiente de aprobación)

### OPCIÓN A — Principal propuesto: **Gemini tier de pago**
- Privacidad: ✅ la mejor verificada (no entrena con datos, confidencial, ZDR). Calidad:
  VLM flash de primer nivel para triaje/emoción/narrativa. Coste: bajo por lote con
  entradas de 512 px (modelos flash). Velocidad: alta, lotes paralelizables, reintentos
  429/503 ya implementados en el seam. Riesgo: el matiz de la key (riesgo P2) —
  resuelto con el mini-transporte de 4.1.
### OPCIÓN B — Fallback propuesto: **Qwen/DashScope**, luego **NVIDIA NIM**
- Privacidad: condicionada a verificación de ToS (P3). Calidad: probada (ya es el
  proveedor activo del core para selección). Coste: bajo. Velocidad: buena (Qwen),
  NVIDIA con 429 documentado → último eslabón. Riesgo: medio.
### OPCIÓN C — Alternativa local: **sin IA remota**
- E1–E3 (grupos + técnica local) + decisión 100 % manual del fotógrafo: coste cero,
  privacidad absoluta, ya viable con la Fase 3.1 (y respaldo si todos los proveedores
  están apagados). Incluye, como variante, un endpoint custom autoalojado del propio
  fotógrafo (servidor propio, OpenAI-compatible) con privacidad máxima.

---

## 12. PROVEEDORES APROBABLES PARA FASE 4.1

Cadena por defecto propuesta (todas las inclusiones sujetas a `providers-test` con
imagen sintética en el Bloque 3 antes de habilitarse):

```text
1º Gemini (key de pago, con mini-transporte propio del módulo)   → APTO
2º Qwen/DashScope (data URL, tras verificar ToS vigentes)        → APTO CON CONDICIONES
3º NVIDIA NIM (data URL, tras verificar ToS; esperado por 429)   → APTO CON CONDICIONES
   Custom (si el usuario registra uno, tras providers-test)      → APTO CON CONDICIONES
   Base44 InvokeLLM                                              → NO APTO (excluido por defecto)
```

Todos los eslabones son configurables por el usuario (`allowed_providers`); ningún
proveedor envía originales; todas las imágenes viajan sanitizadas e inline; ninguna se
almacena en la plataforma Base44.

---

# FIN DE LA FASE 4.0.1

Sin implementación, sin `album-engine`, sin endpoints, sin fotografías reales enviadas
y sin modificación de archivo o configuración alguna (único artefacto: este documento).
Pendiente de tu decisión: la cadena recomendada (Gemini pago → Qwen → NVIDIA) y el
mini-transporte de la key de pago como parte de `album-engine` en 4.1.

# DETENIDO — ESPERANDO APROBACIÓN EXPLÍCITA PARA INICIAR FASE 4.1