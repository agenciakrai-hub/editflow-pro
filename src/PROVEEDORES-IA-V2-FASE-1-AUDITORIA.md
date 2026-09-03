# PROVEEDORES IA V2 — FASE 1: AUDITORÍA REAL + PROPUESTA DE ARQUITECTURA
Fecha: 2026-09-03 · Fase exclusivamente de AUDITORÍA y DISEÑO. CERO código, cero
entidades, cero modificaciones. Basado en lectura directa de: `src/pages/AIProviders.jsx`,
`base44/functions/ai-providers/entry.ts`, `base44/shared/aiProviderAdapter.ts`,
`base44/functions/rawAiSmartSelect/entry.ts`, `rawAiStudioAnalyze`, `rawAiVisualDevelop`,
`rawAiHybridProfile`, `styleGalleryAnalyze`, `editflow-engine`, `src/lib/ai/aiGateway.js`,
`visualDevelopEngine.ts`, `hybridDevelopEngine.ts` y las entidades
`AiProviderConfig`, `CustomAiProvider`, `AlbumAIConfig`.

---

# PARTE A — AUDITORÍA DEL SISTEMA ACTUAL

## A1. CÓMO FUNCIONA HOY LA HERRAMIENTA DE PROVEEDORES

```text
src/pages/AIProviders.jsx  (/proveedores-ia, SOLO admin visualmente)
        │  invoca con base44.functions.invoke("ai-providers", ...)
        ▼
base44/functions/ai-providers/entry.ts  (guarda: 401 sin sesión · 403 si role≠admin)
        ├─ get-config / save-config ──► entidad AiProviderConfig (registro ÚNICO global)
        ├─ list/add/retest/toggle/delete-custom ──► entidad CustomAiProvider
        ├─ test-connection (qwen|nvidia|gemini) ──► aiProviderAdapter (ping real)
        ├─ test-nvidia-vision ──► prueba con 1 foto (data URL directa)
        └─ detect-model ──► consulta /models del proveedor OpenAI-compatible
```

**Ruteo en tiempo de ejecución** (`aiProviderAdapter.invokeVision`):
1. Lee el registro único `AiProviderConfig` (service role) → `active_seleccion` /
   `active_ajustes` (un proveedor por herramienta, global para TODOS los usuarios).
2. **Failover en cadena** (solo cuando no hay `forceProvider`): activo → personalizados
   habilitados → qwen/gemini/nvidia habilitados → **Base44 InvokeLLM como último recurso**.
3. `forceProvider` (usado por Album AI) desactiva el failover y fuerza un proveedor.

**Credenciales actuales** (hallazgo clave):
- Qwen, NVIDIA y Gemini usan **secrets de la app** (QWEN_API_KEY, NVIDIA_API_KEY,
  GEMINI_API_KEY) = **claves del administrador**. Todos los usuarios de la app consumen
  IA con **los créditos y la facturación del administrador**.
- `GEMINI_API_KEY_PAID` existe pero es EXCLUSIVA de album-engine (no del Core).
- Los proveedores personalizados guardan su **API key en TEXTO PLANO** dentro del
  campo `api_key` de la entidad `CustomAiProvider` (RLS admin, pero sin cifrado).

## A2. ENTIDADES QUE UTILIZA

| Entidad | Rol | RLS | Observación |
|---|---|---|---|
| `AiProviderConfig` | Registro ÚNICO global: endpoints, modelos, enabled por proveedor, proveedor activo por herramienta | admin | Un solo registro decide para todos los usuarios |
| `CustomAiProvider` | Proveedores personalizados (name, endpoint, model, **api_key plano**, enabled, last_ok) | admin | API key sin cifrar en BD; se enmascara al listar (nunca se devuelve por la API) |
| `AlbumAIConfig` | Consentimiento/cadena del módulo Album AI (por usuario) | por usuario | Perteneciente a Album AI; **fuera del alcance de V2** (ver A6) |

Secrets de la app consumidos: `QWEN_API_KEY`, `NVIDIA_API_KEY`, `GEMINI_API_KEY`
(+ `GEMINI_API_KEY_PAID` solo en album-engine).

## A3. MÓDULOS QUE DEPENDEN DEL SISTEMA (mapa verificado)

| Módulo / función backend | Qué usa | Proveedor/modelo real hoy |
|---|---|---|
| **Selección IA (culling)**: `smartSelectionEngine` (cliente) → `rawAiSmartSelect` | `invokeVision` con **failover completo** (task=seleccion) | Activo de `active_seleccion` + cadena → Base44 `claude_sonnet_4_6` como último recurso. Previews vía **UploadFile** (almacenamiento) |
| **Ajustes IA (clásico)**: `aiGateway.analyzePhotos` → `rawAiStudioAnalyze` | **InvokeLLM DIRECTO** (no pasa por aiProviderAdapter) | Base44 puro (créditos Base44 del admin) |
| **Revelado IA Visual**: `rawAiVisualDevelop` → `visualDevelopEngine` | `invokeVision` (data URLs directas, sin UploadFile) | Proveedor activo de `active_ajustes`, forzado a Qwen si no hay |
| **Revelado Híbrido**: `rawAiHybridProfile` → `hybridDevelopEngine` | `invokeVision` (1 llamada por sesión) | Activo de `active_ajustes`, forzado a Qwen si no hay |
| **Creador de estilos**: `styleGalleryAnalyze` | `invokeVision` (task=ajustes) | Activo de `active_ajustes` |
| **Album AI (Fase 4.1)**: `album-engine` | Cadena PROPIA aislada (gemini_paid→qwen→nvidia) + `invokeVision({forceProvider})` en SOLO LECTURA | Aislado por diseño de privacidad; consume `GEMINI_API_KEY_PAID` y secrets |
| **Página AIProviders** + función `ai-providers` | Config + tests + CRUD personalizados | — |
| `editflow-engine` | **NO depende de proveedores IA** (XMP/plugin/Lightroom) | — |

Páginas frontend dependientes: `AIProviders.jsx` (config), `Seleccion.jsx` y
`AjustesIA.jsx` (consumen vía `aiGateway`, sin conocer el proveedor), `Estilos/Cerebro`
(indirecto vía styleGalleryAnalyze).

## A4. APIs Y SERVICIOS CONECTADOS (transportes reales verificados)

1. **Base44 InvokeLLM** (integración platform) — requiere UploadFile para imágenes.
2. **Qwen DashScope** — OpenAI-compatible `/chat/completions`, data URLs inline.
3. **NVIDIA NIM** — OpenAI-compatible, data URLs inline.
4. **Google Gemini** — API nativa `generateContent` (inline_data), reintentos 429/503.
5. **Gemini de pago (solo Album AI)** — misma API, key `GEMINI_API_KEY_PAID`.
6. **Proveedores personalizados** — cualquier endpoint OpenAI-compatible
   (`/chat/completions`), con detección de modelos vía `/models`.

## A5. QUÉ PUEDE REUTILIZARSE / QUÉ DEBE SUSTITUIRSE

**REUTILIZAR (transporte probado, sin cambios de fondo):**
- Las 6 capas de transporte de `aiProviderAdapter` (callQwen, callGemini, callNvidia,
  callCustom, parseJsonLoose, fetchWithTimeout) — son seam puro, sin estado.
- Los tests de conexión/visión y `detectBestModel` (base del futuro botón
  "Sincronizar modelos").
- La lógica de negocio de los motores (prompts, schemas, scoring, consolidación) —
  V2 solo cambia CÓMO se elige y autentica el proveedor, no el análisis.
- El patrón de `aiGateway.js` (frontera estable página↔backend): V2 añade un
  enrutador equivalente sin romper el existente.
- Enmascarado de claves en `ai-providers` (nunca devuelve la key).

**SUSTITUIR INTERNAMENTE (las causas raíz de V2):**
1. **Registro único global** (`AiProviderConfig`): un solo `active_seleccion/ajustes`
   para todos los usuarios, gestionado por el admin → sustituir por configuración
   **por usuario y por herramienta**.
2. **Credenciales del administrador** (secrets de la app): todos los usuarios consumen
   los créditos del admin → sustituir por **API key propia de cada usuario**.
3. **API key en texto plano** en `CustomAiProvider.api_key` → sustituir por
   almacenamiento cifrado y aislamiento por usuario (ver B4).
4. **Sin catálogo de modelos**: hoy "proveedor = 1 modelo" (qwen_model, nvidia_model,
   gemini_model son strings sueltos) → sustituir por **catálogo de modelos con
   capacidades, estado, valoraciones y certificación**.
5. **Sin sincronización**: solo existe `detectBestModel` puntual → añadir sync real
   por proveedor con detección de altas/bajas.
6. **Failover hardcodeado en el adapter** → mover a configuración (preparado, sin
   implementar lógica nueva de inicio).

## A6. RIESGOS DE CREAR PROVEEDORES IA V2 EN PARALELO

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Doble fuente de verdad: motores leyendo config antigua y nueva a la vez | Alta | Fases de migración por módulo con checkpoint; NINGÚN motor se toca hasta su fase |
| Almacenar API keys de usuarios en entidades (plano por limitación de plataforma) | Alta | Cifrado AES-GCM en backend con clave de app (secret), nunca devolver la clave (solo hint+estado), RLS por usuario, service-role filtrando por user_id (B4) |
| Fuga de clave por logs/errores | Alta | Regla del adapter actual ya se mantiene: solo `key_present` en respuestas; auditoría de mensajes de error en V2 |
| Coste/latencia de sync de modelos (OpenRouter tiene miles) | Media | Sync con paginación y filtrado por capacidades; marcar no-clasificados como "experimental" |
| Romper el aislamiento de Album AI | Alta | **Decisión de diseño**: album-engine NO se migra a V2 en este ciclo (su cadena y consentimiento son parte de su arquitectura de privacidad aprobada). Pendiente de tu decisión |
| Ruptura de la herramienta antigua durante la coexistencia | Media | V2 es 100 % aditiva: nuevas entidades, nueva función, nueva página; nada del sistema actual referencia V2 hasta su fase de migración |
| Créditos Base44 agotados (problema conocido) como último recurso del failover | Media | V2 deprecia progresivamente InvokeLLM como transporte (queda solo como legado hasta Fase 7) |

---

# PARTE B — PROPUESTA DE ARQUITECTURA: PROVEEDORES IA V2

## B1. PRINCIPIOS

- **En paralelo, aditivo y reversible**: nada del sistema actual se toca hasta su fase
  de migración; en cualquier checkpoint se puede desactivar V2 sin rastro.
- **Dos planos separados**: ADMINISTRACIÓN GLOBAL (admin) y CONFIGURACIÓN DE USUARIO
  (cada usuario con sus claves y sus motores activos).
- **Regla fundamental**: cada usuario consume IA EXCLUSIVAMENTE con SU API key. Las
  claves del admin dejan de usarse para usuarios finales (los secrets de la app quedan
  como credenciales del admin para pruebas de laboratorio y modelos propios del sistema).

## B2. ENTIDADES NUEVAS PROPUESTAS (todas aditivas; a crear solo tras tu aprobación)

```text
AiProviderV2            [RLS admin]  — catálogo de proveedores compatibles
  name, logo_url, description, official_url, base_endpoint,
  api_type ("openai_compatible" | "gemini_native" | "custom_http"),
  auth_method ("bearer" | "query_key"),
  status ("active" | "inactive" | "testing"), models_sync_supported (bool),
  sync_endpoint, last_sync (date)

AiModelV2               [RLS admin]  — catálogo de modelos (ficha completa)
  provider_id, model_id_tecnico, display_name, family, version, updated,
  status ("available" | "unavailable" | "experimental" | "certified_editflow"),
  capabilities { vision_photo, vision_people, faces, expressions, eyes_closed,
    image_compare, composition, aesthetic, edit_image, image_gen, transform,
    inpaint, retouch, color, restore, text, reasoning, multimodal, audio, video },
  compatible_tools ["seleccion","edicion", ...],
  pricing ("free" | "paid"),        // y a futuro: pricing_detail
  rating_reference { score(0-10), source, updated, confidence } | null,
  rating_editflow (0-10, manual admin),
  recommended (bool), certified (bool), disappeared (bool)

UserAiCredentialV2      [RLS por usuario]  — claves del usuario
  provider_id, api_key_encrypted (AES-GCM), key_hint (últimos 4), label,
  status ("ok" | "invalid" | "unverified"),
  last_test { ok, latency_ms, http_status, checked }

UserEngineConfigV2      [RLS por usuario]  — motor activo por herramienta
  tool ("seleccion" | "edicion" | ...),          // un registro por herramienta
  provider_id, model_id,
  fallbacks [ {provider_id, model_id} ]          // PREPARADO para el futuro (§15),
                                                  // inicialmente solo se persiste
```

`rating_reference: null` → la UI muestra **"Información insuficiente"**. Nunca se
inventan puntuaciones.

## B3. FUNCIÓN BACKEND NUEVA: `ai-providers-v2` (paralela a la actual)

```text
SECCIÓN ADMIN (role=admin)
  upsert-provider · delete-provider
  sync-models        → llama al sync_endpoint del proveedor (OpenAI-compatible /models
                       o Gemini ListModels), crea modelos nuevos como "experimental",
                       marca disappeared= los que falten (NUNCA borra configs sin confirmar)
  upsert-model-meta  → capacidades, compatible_tools, pricing, rating_editflow,
                       recommended, certified, rating_reference
SECCIÓN USUARIO (cualquier usuario autenticado; solo toca SUS registros)
  list-catalog       → proveedores activos + modelos compatibles por herramienta (solo
                       lectura; sin datos admin sensibles)
  save-credential    → recibe la key UNA VEZ, cifra AES-GCM (backend), guarda hint
  update/delete-credential
  test-connection    → ping al proveedor CON LA CLAVE DEL USUARIO (service role lee el
                       registro cifrado de ESE user_id); devuelve ok/latency/http_status
  set-engine         → provider+modelo por herramienta (valida compatibilidad de
                       capacidades server-side)
  test-model         → ping al modelo concreto + latencia + disponibilidad
                       (arquitectura lista para un futuro laboratorio con fotos de referencia)
```

**Seguridad**: la clave cifrada NUNCA sale del backend; las respuestas solo incluyen
`key_hint` y `status`; sin claves en logs ni mensajes de error; aislamiento total por
`created_by_id` + filtrado service-role por user_id.

## B4. CIFRADO DE CLAVES (propuesta concreta, pendiente de tu aprobación)

Limitación de plataforma: las entidades no ofrecen cifrado en reposo. Propuesta:
cifrado **AES-256-GCM en el backend** con clave maestra guardada como **secret de la
app** (`AI_KEYS_MASTER_KEY`, la generas tú en Secrets). La clave viaja del navegador al
backend UNA sola vez (al guardar), se cifra y solo se descifra en memoria para llamar
al proveedor. Alternativa más simple (sin cifrado, solo opacidad + RLS) también es
posible — decisión tuya en el checkpoint de B4.

## B5. ENROUTADOR V2 (el seam que hace posible la migración módulo a módulo)

```text
base44/shared/aiModelRouterV2.ts   (NUEVO; aiProviderAdapter queda intacto)
  resolveEngine(base44, userId, tool)
    → { provider, model, credential(decrypt), api_type, transport }
    → devuelve además la lista fallbacks (futura §15)
  callModel(...) → reutiliza los transportes ya probados del adapter actual
                   (qwen/gemini/nvidia/custom OpenAI-compatible)
```
Cada motor migra cambiando ÚNICAMENTE su llamada de `invokeVision(...)` a
`resolveEngine + callModel(...)`. Si V2 no tiene config del usuario → el motor sigue
usando la ruta antigua (coexistencia segura durante la migración).

## B6. INTERFAZ (nueva página, en paralelo)

Ruta propuesta `/proveedores-ia-v2` (la actual `/proveedores-ia` queda intacta hasta
Fase 7). Estructura:

```text
┌─ MODO ADMIN ────────────────────────────────┐  ┌─ MODO USUARIO ──────────────┐
│ PROVEEDORES (alta, logo, endpoint, estado,  │  │ Mis proveedores conectados  │
│  🔄 Sincronizar modelos)                    │  │  🔑 Conectar mi API Key     │
│ MODELOS (fichas: capacidades, gratis/pago,  │  │  🟢 Probar conexión         │
│  ⭐ Recomendado · 🏆 Certificado ·          │  │ MOTORES ACTIVOS            │
│  Referencia externa X/10 · EditFlow Y/10)   │  │  Selección: proveedor+modelo│
│                                             │  │  Edición:   proveedor+modelo│
│                                             │  │  🧪 Probar modelo           │
└─────────────────────────────────────────────┘  └─────────────────────────────┘
```
- Filtros por herramienta SOLO con modelos de capacidades compatibles (selección =
  visión/análisis; edición = edición/generación/transformación).
- Separación visual MOTORES DE SELECCIÓN / MOTORES DE EDICIÓN, y dentro GRATUITOS /
  DE PAGO. Dos valoraciones SIEMPRE separadas (Referencia externa / EditFlow).

## B7. PLAN DE MIGRACIÓN (tus 7 fases, con checkpoints)

| Fase | Contenido | Checkpoint |
|---|---|---|
| 1 | ✅ Esta auditoría + diseño (aprobación requerida) | Aprobación de entidades B2, cifrado B4 y decisión A6 (Album AI) |
| 2 | Crear entidades V2 + `ai-providers-v2` + `aiModelRouterV2` + página V2 (admin: altas de proveedores OpenRouter/NVIDIA/Gemini + sync; usuario: claves + pruebas) | Alta proveedor · sync modelos · clave usuario cifrada · test conexión (imagen sintética, NUNCA fotos reales) |
| 3 | Pruebas aisladas de V2 con imagen sintética + un usuario piloto (tú) | Sincronización, clasificación de capacidades, selección de modelos, prueba de modelo |
| 4 | Migrar SELECCIÓN: `rawAiSmartSelect` cambia a `aiModelRouterV2` (con fallback a ruta antigua si el usuario no tiene config V2) | Selección completa con clave del usuario; comparación de resultados |
| 5 | Migrar EDICIÓN: `rawAiStudioAnalyze`, `rawAiVisualDevelop`, `rawAiHybridProfile` (esto deprecia InvokeLLM directo en Ajustes) | Ajustes + Revelado Visual + Híbrido con V2 |
| 6 | Migrar `styleGalleryAnalyze` (Creador de estilos) y preparar futuros módulos | Estilos con V2 |
| 7 | Solo con TODO migrado y probado: eliminar herramienta antigua (AIProviders.jsx, ai-providers, AiProviderConfig, CustomAiProvider, invokeVision legacy) | Regresión completa |

## B8. DECISIONES QUE REQUIEREN TU APROBACIÓN EXPLÍCITA

1. **Crear las 4 entidades nuevas** de B2 (todas aditivas; RLS admin/usuario).
2. **Cifrado de claves** B4: AES-GCM con secret `AI_KEYS_MASTER_KEY` (recomendado) vs
   solo opacidad+RLS.
3. **Album AI NO se migra** a V2 en este ciclo (mantiene su cadena y consentimiento
   aislados, según la arquitectura de privacidad aprobada en Fase 4.0.1). Si quieres
   migrarlo más adelante, será un proyecto aparte.
4. **Transporte Base44 InvokeLLM queda deprecated** en V2 (sin UploadFile para claves
   de usuario; créditos Base44 conocidos agotados). El failover antiguo sigue intacto
   para el sistema actual hasta Fase 7.
5. Nombres y ruta de la página V2 (`/proveedores-ia-v2`).

---

# FIN DE FASE 1 — SOLO AUDITORÍA Y DISEÑO. CERO CÓDIGO MODIFICADO.
# DETENIDO. ESPERANDO TU APROBACIÓN Y LAS DECISIONES DE B8 PARA INICIAR FASE 2.