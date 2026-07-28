# Tasks — aa-agente-consola-pruebas

Tests con **vitest** (AA back). Front: `tsc` + test de componente si el harness lo
admite. DONE solo con test verde.

## F1 — Instrumentación backend (aditiva, regresión cero)

- [x] **T1.1 — Latencia por turno.** Medir wall-time del turno en
  `chatWithAgent`/`runAgent`; añadir `latencyMs?: number` a `AgentReply` (`types.ts:14`)
  y propagarlo en la respuesta de `/api/chat` (`ai.ts`).
  - Test: `/api/chat` devuelve `latencyMs` numérico ≥ 0.
- [x] **T1.2 — Modo test + columna Conversation.** `Conversation.isTest Boolean
  @default(false) @map("es_prueba")` + migración aditiva. `POST /api/chat` acepta
  `test?:boolean` → propaga a `chatWithAgent` → marca la conversación. Metering intacto.
  - Test: `test:true` → `isTest=true`; sin flag → `isTest=false` (regresión);
    `deductTokens` sigue llamándose en modo test.
  - ~~**Nota**: migración `20260717010000_conversation_is_test` creada, NO aplicada
    (DATABASE_URL apunta a Supabase remoto compartido; `migrate dev/deploy` requiere
    HITL). `prisma migrate status` confirma pendiente.~~ — **OBSOLETA (28/07/2026)**: la
    columna `es_prueba` existe en producción y el historial de Prisma está limpio — 14
    migraciones en disco, 14 aplicadas, 0 pendientes, 0 fantasma, 0 fallidas. La de
    `conversation_is_test` fue absorbida por el squash a baseline. No hay nada que aplicar.
- [x] **T1.3 — Excluir tests de listados/analítica del cliente.** Filtro por defecto
  `isTest=false` en los listados de conversaciones y en la analítica que ve el cliente.
  - Test: un listado/aggregate de cliente no incluye conversaciones `isTest=true`.
- [x] **T1.4 — Estado del agente para el banner.** Exponer nº de chunks / hasKnowledge
  al front (reusar `engine.ts:553`; incluir en el payload del agente de la ficha si ya
  viaja, o endpoint ligero). 
  - Test: el agente cargado por la ficha expone el conteo de conocimiento.
  - **Nota**: sin cambio de código productivo — `getAgentDetail` ya exponía
    `_count.knowledge`; solo test de caracterización.

## F2 — UI Consola de pruebas (hiper-intuitiva)

- [x] **T2.1 — Reconstruir `ChatTester` → Consola.** Consumir `toolCalls`+`tokensUsed`+
  `model`+`latencyMs` de `/api/chat` (hoy descartados). Enviar `test:true`.
- [x] **T2.2 — Banner de estado** (canal · nº fragmentos · modelo · 🟢/🟡 listo).
  Aviso llamativo si 0 chunks (enlace a pestaña Conocimiento).
- [x] **T2.3 — Desglose por turno** colapsable "Ver qué hizo el agente (N acciones)":
  mapa `tool → {icon,label}`, render especial de `search_knowledge` (fuente + snippet +
  % de similitud), args/resultado legibles, aviso en `error`.
- [x] **T2.4 — Footer por turno** (latencia · tokens · modelo) + botón Reiniciar +
  empty state + estado "pensando…".
- [x] **T2.5 — Renombrar pestaña** `chat` → "Probar agente" (`page.tsx:23`).
- [x] **T2.6 — Copy en lenguaje llano** revisado (sin jerga cruda visible).
  - Test: `front npx tsc --noEmit` verde; test de render (si harness admite): chunk
    pinta fuente+%, error pinta aviso.
  - **Nota (deuda F1)**: el conteo de "fragmentos" del banner usa
    `knowledgeSources` (ya cargado en `useAgentDetail`/pestaña Conocimiento), no un
    campo `hasKnowledge`/conteo expuesto por el backend en el payload del agente
    (T1.4, aún no implementado). Funcionalmente equivalente hoy (mismo dato, ya en
    memoria del front); si T1.4 se implementa, puede simplificarse a leer ese
    campo directamente del agente.

## Verificaciones finales

- [x] **T3.1 — Typecheck + suite** (`back` vitest + tsc, `front` tsc) verde. — verificado 28/07/2026: back 146 ficheros / 1726 tests verdes (3 skipped) y `tsc --noEmit` exit 0; front `tsc --noEmit` exit 0.
- [ ] **T3.2 — Verificación visual** de la consola (HITL): probar un agente real, ver
  tools + chunks + tokens + latencia. — ⏳ GATE HUMANO real: requiere abrir la consola contra un agente vivo. No hay forma de sustituirlo por un test.
- [x] **T3.3 — sec-review** (modo test no evade metering; flag no expone datos de otros
  tenants; `/api/chat` sigue verificando saldo). — hecho 28/07/2026, leyendo el código, no el documento. Resultados:
  - **`/api/chat` sigue verificando saldo: SÍ.** La exención de `isTest` en `assertUsageAllowed` es acotada a «no exigir tenant»; con tenant, cupo y kill switch se comprueban igual (`token-metering.ts:224-232`).
  - **El modo test no evade el metering del turno: correcto.** `engine.ts:1036` llama `deductTokens` sin mirar `isTest`.
  - **El flag no expone datos de otros: correcto.** Los listados del cliente filtran `isTest:false` (`service.ts:71` y `service.ts:542`).
  - **HUECO ENCONTRADO Y CERRADO**: el filtro era `Boolean(test) && Boolean(req.user)` — exigía sesión, pero un usuario de portal (`role = "client"`) también la tiene, y `clientScopeGate` no lo frena aquí porque deja pasar las rutas públicas ANTES de mirar su allowlist. Ahora exige staff (`ai.ts`, `req.user?.role !== CLIENT_ROLE`), con 3 regresiones nuevas en `tests/metering-chat-route.test.ts` (client se ignora; editor y viewer se honran).
  - **Incoherencia DOCUMENTADA, no corregida**: `lead-intent.ts` no imputa en modo test mientras el turno principal sí lo hace. Es deliberada —`tests/lead-intent.test.ts` la fija— así que invertirla cambia a quién se le cobra y queda como decisión del propietario. Efecto conocido: los tokens de esa inferencia no aparecen en `uso_tokens` e infravaloran el coste de plataforma de las pruebas.
- [x] **T3.4 — Engram**: persistir el patrón (consola reusa `/api/chat`, no duplica
  runtime). — persistido 28/07/2026 bajo `architecture:aa-consola-pruebas`: el reuso de `/api/chat`, el gotcha de que exigir sesión ≠ exigir staff en una ruta pública, qué exime y qué no `isTest`, y la excepción deliberada de `lead-intent`.

## Follow-ups (fuera de scope)
- **H1b**: streaming SSE token-a-token (hoy bloqueante, `engine.ts:443`).
- Latencia por-tool (timestamps por llamada) + coste monetario en €.
