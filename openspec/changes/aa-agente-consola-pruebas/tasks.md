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
  - **Nota**: migración `20260717010000_conversation_is_test` creada, NO aplicada
    (DATABASE_URL apunta a Supabase remoto compartido; `migrate dev/deploy` requiere
    HITL). `prisma migrate status` confirma pendiente.
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

- [ ] **T3.1 — Typecheck + suite** (`back` vitest + tsc, `front` tsc) verde.
- [ ] **T3.2 — Verificación visual** de la consola (HITL): probar un agente real, ver
  tools + chunks + tokens + latencia.
- [ ] **T3.3 — sec-review** (modo test no evade metering; flag no expone datos de otros
  tenants; `/api/chat` sigue verificando saldo).
- [ ] **T3.4 — Engram**: persistir el patrón (consola reusa `/api/chat`, no duplica
  runtime).

## Follow-ups (fuera de scope)
- **H1b**: streaming SSE token-a-token (hoy bloqueante, `engine.ts:443`).
- Latencia por-tool (timestamps por llamada) + coste monetario en €.
