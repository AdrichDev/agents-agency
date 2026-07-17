# Tasks — aa-agent-external-crm-and-lead-qualification

Orden crítico: F1 antes que el E2E (el agente necesita alcanzar el CRM). F2 es
independiente de F1 y puede ir en paralelo. Cada tarea DONE solo con su test
verde.

## F1 — Backend `external_api`

- [x] **T1.1 — Confirmar shapes del CRM.** HECHO (2026-07-17). Leídos `public/{leads,bookings,availability}.ts`; shapes exactos volcados en design.md §B.2. Hallazgo: `bookings`/`availability` exigen `locationId`; `availability` es por-día (`YYYY-MM-DD`); `bookings` toma `start` ISO + `customer{}`. Config del adapter amplía a `locationId`.
- [x] **T1.2 — Adapter `ExternalApiAdapter`.** Crear `back/src/lib/agent-backend/external-api.ts` implementando `AgentBackendAdapter` (mapeo §B.2). Bearer opcional, timeout con AbortController, capability-gate por método, input solo como dato.
  - Test: `back/tests/external-api-adapter.test.ts` (`fetchImpl` mock) — cada método → método+URL+body correctos; gate de capability rechaza si no habilitada; Bearer presente/ausente; `cancelarReserva`/`consultarPedido` → no-soportado honesto; timeout → error de tool; `notificar` NUNCA lanza. **VERDE (13/13, vitest — ver nota abajo).**
- [x] **T1.3 — Wire-in resolver.** Rama `external_api` en `resolveAgentBackendAdapter` (`managed-db.ts` §resolver): descifra `apiKeyEncrypted`, lee `businessId` de `dbSchema`, instancia el adapter.
  - Test: añadido a `back/tests/managed-db-adapter.test.ts` (mismo fichero, opción del task) — `mode=external_api` → instancia `ExternalApiAdapter`; `managed_db`/`none_yet` sin cambios; falta `apiBaseUrl`/`businessId` → error claro. **VERDE (27/27).**
- [x] **T1.4 — Alta del modo en `createAgent`.** `CreateAgentDataBackendInput` + validación en `service.ts`: aceptar `external_api` con `apiBaseUrl`+`businessId` (requeridos) y `apiKey` (opcional, cifrar `enc:v1:` al persistir).
  - Test: añadido a `back/tests/agents-create-backend.test.ts` (fichero existente de este mismo AC, en vez de crear `agent-backend-external-api-create.test.ts` nuevo — evita fragmentar la cobertura de `createAgentSchema`+`createAgent` ya centralizada ahí) — crea backend external_api válido; falta apiBaseUrl/businessId → 400; `apiKey` se persiste cifrado (`enc:v1:`, nunca en claro); sin apiKey → `apiKeyEncrypted` undefined; `managed_db`/`none_yet` sin regresión. **VERDE (12/12).**
- [x] **T1.5 — Gate de capabilities.** Ampliar `enabledBackendCapabilities` (`engine.ts:82`) a `managed_db || external_api`; limitar capabilities external_api a `["reservas","leads"]`. (Movida a `agent-backend/managed-db.ts` y re-exportada desde `engine.ts` para evitar un ciclo `engine.ts` ⇄ `executor.ts`, ya que `executor.ts` también la necesita para T2.2.)
  - Test: añadido a `back/tests/agent-backend-tools.test.ts` — `buildAgentTools` monta `consultar_disponibilidad`/`crear_reserva`/`guardar_lead`/`calificar_lead` para un agente external_api; NO monta `consultar_pedido` (ni con capability `pedidos` legada/manual); agente sin backend → sin tools de datos (regresión cero). **VERDE (32/32).**

## F2 — Calificación de lead

- [x] **T2.1 — Migración `Lead.qualification`.** Añadido `qualification` (default `"unknown"`) + `qualificationReason` a `Lead` (`schema.prisma`). SQL aditivo (`prisma/migrations/20260717000000_lead_qualification/migration.sql`), solo `ALTER TABLE ADD COLUMN`, sin DROP. `prisma validate` + `prisma generate` OK. **NO aplicada a la BD cloud (HITL — ver nota final).**
  - Test: `back/tests/lead-qualification.migration.test.ts` (patrón `agent-data-backend.migration.test.ts`, puro regex sobre schema+SQL, sin BD real) — columnas presentes con el contrato exacto de design.md §C.1, default `'unknown'`, migración aditiva (sin DROP/DELETE/UPDATE/TRUNCATE/CREATE TABLE/INSERT), único ALTER sobre `lead`. **VERDE (6/6).**
- [x] **T2.2 — Tool `calificar_lead`.** Declarada en `BACKEND_TOOLS_BY_CAPABILITY["leads"]` (`tools.ts`) y handler en `executor.ts`: upsert del `Lead` por `conversationId` (gate por capability `leads`, independiente del adapter — no habla con el CRM externo); en `hot` dispara `notify-dispatcher` best-effort.
  - Test: `back/tests/calificar-lead.test.ts` — actualiza `qualification`+`qualificationReason`; `hot` llama `dispatchNotification("nuevo_lead", {...lead, qualification:"hot"})` (spy); `warm`/`cold` no notifican; gate por capability `leads` en managed_db y external_api; sin lead previo → upsert crea mínimo; sin `conversationId` → `qualified:false` sin tocar Prisma; qualification inválida → error claro. **VERDE (11/11).**
- [x] **T2.3 — Rúbrica en el prompt.** Bloque HOT/WARM/COLD en `buildSystemPrompt` (`engine.ts`) solo si `leads` habilitado (managed_db o external_api indistintamente).
  - Test: añadido a `back/tests/agent-backend-tools.test.ts` — prompt contiene la rúbrica (`calificar_lead`, HOT/WARM/COLD) con `leads` on en ambos modos; NO la contiene con `leads` off ni sin backend (regresión). **VERDE (incluido en los 32/32 de T1.5).**

## Verificaciones finales

- [x] **T3.1 — Regresión cero.** Cubierto por los tests de regresión ya existentes (`skill-instructions.test.ts`, `agent-backend-tools.test.ts`, `managed-db-adapter.test.ts`): agente `managed_db` y agente sin backend → mismas tools/prompt que antes del cambio. **VERDE.**
- [x] **T3.2 — Typecheck + suite.** `npm run typecheck` (`tsc --noEmit`) → 0 errores. `npm test` (vitest, ver nota abajo) → **892 passed, 3 skipped, 8 failed** en `tests/openai-agent-client.test.ts` (runtime `openclaw`, `TypeError: Cannot read properties of null (reading 'chat')` en `src/lib/openai.ts:77`) — **pre-existentes, confirmados sin relación**: cero diff en `openai.ts` ni en su test; el fallo ya está presente en el estado actual del working tree al margen de este change.
- [x] **T3.3 — sdd-verify** (2026-07-17): VERDICT **PASS**, AC1-AC10 verificados contra código real (Engram #940). 0 critical / 0 warning / 3 notas de riesgo no bloqueantes. Suite 900 verdes (los 8 fallos openai ya fixeados), typecheck 0. Falta: code-review humano + commit (HITL).
- [ ] **T3.4 — E2E local opcional.** No ejecutado — requiere `.env.test` con Supabase `_test_crm` + `creador_CRM` corriendo local; documentado como opcional, no bloqueante.
- [x] **T3.5 — Persistir decisiones en Engram** (protocolo save): arquitectura del adapter external_api + rúbrica de calificación + decisión de mover `enabledBackendCapabilities` para evitar ciclo. Hecho (`mem_save`, ver sesión).

### Nota — desviación deliberada: vitest en vez de `node:test`

El plan original de esta tarea pedía tests `node:test` ("patrón del repo (no vitest)", design.md §D). Verificado contra el repo real: `package.json` (`"test": "vitest run"`), `vitest.config.ts` (`include: ["tests/**/*.test.ts"]`) y **absolutamente todos** los tests existentes (incluido el fichero citado como patrón, `agent-data-backend.migration.test.ts`) importan de `"vitest"`, no de `"node:test"`. Escribir en `node:test` habría producido ficheros que `npm test` nunca ejecuta (0% cobertura real). Se decidió seguir el patrón real y verificable del repo (vitest) para que "DONE solo con test verde" sea cierto en la práctica. Desviación señalada explícitamente aquí y en el reporte final.

## Notas de orden y follow-ups (fuera de este change)

- Auto-conversión lead→cliente (endpoint CRM autenticado) — follow-up.
- Propagar `qualification` al `Contacto` del CRM — follow-up (campo/endpoint en `creador_CRM`).
- Auth por API-key en el lane público del CRM (hardening multi-tenant) — follow-up.
- Rúbrica de calificación editable per-agente — follow-up.
- VAPI ("llámame ahora") — change aparte.
