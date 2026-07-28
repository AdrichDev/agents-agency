# Tasks — aa-metering-fail-closed

Regla del repo: **una tarea es DONE sólo con su test verde.**

## T1 — Gate de uso fail-closed

- [x] **T1.1** — `assertUsageAllowed(tenantId, { isTest })` en
  `back/src/lib/token-metering.ts`. Fail-closed: `tenantId` ausente ⇒ `HttpError(402)`.
  Exención `isTest`. Delega en `checkClientBalance` cuando hay tenant.
  *Test:* `tests/metering-fail-closed.test.ts` → 5 casos (sin tenant → 402; sin tenant +
  isTest → null; tenant sin cupo → 402; tenant desactivado → 402; tenant con cupo → id).
- [x] **T1.2** — Corregir el comentario de cabecera del módulo (línea 11), que documentaba
  como intencional el comportamiento que este change elimina.
  *Test:* n/a (documentación); cubierto por revisión.

## T2 — Intercepción en el cuello único

- [x] **T2.1** — `runAgent`: parámetro `isTest = false` al final de la firma (aditivo).
  `assertUsageAllowed(agent.tenantId, { isTest })` tras el `findUniqueOrThrow` y **antes**
  de `buildAgentTools`.
  *Test:* agente huérfano ⇒ 402 y `openai.chat.completions.create` **no** invocado.
- [x] **T2.2** — `AgentReply.meteredTenantId?: string | null` (aditivo, opcional).
  *Test:* cubierto por T2.3.
- [x] **T2.3** — `chatWithAgent`: propagar `isTest` a `runAgent`; `deductTokens` usa
  `reply.meteredTenantId` en vez del parámetro `clientId`, marcado deprecado y sin efecto.
  *Test:* canal `telegram` **sin** pasar `clientId` ⇒ `deductTokens` con el tenant del
  agente; y un `clientId` ajeno del llamador se ignora (se cobra al tenant real).
- [x] **T2.4** — *(no previsto, hallazgo durante la implementación)* Gate **también** al
  entrar en `chatWithAgent`, antes de crear/leer la `Conversation`. El gate de `runAgent`
  no bastaba: el flujo de captación de lead puede responder sin llegar a `runAgent`
  (`flowResult.handled`), así que un tenant desactivado seguía atendiendo y creando leads —
  el kill switch debe cortar el **servicio**, no sólo el gasto —, y la `Conversation` se
  creaba antes del corte, dejando una fila por intento desde una ruta pública.
  *Test:* tenant bloqueado ⇒ `prisma.conversation.create` **no** llamado.

## T3 — Ajuste de llamadores

- [x] **T3.1** — `back/src/routes/ai.ts`: guard redundante eliminado, import
  `checkClientBalance` retirado, y `HttpError.status` mapeado en el `catch` (antes 500 fijo).
  *Test:* `tests/metering-chat-route.test.ts` → 402 llega como 402 con su motivo; un fallo
  no-HttpError sigue siendo 500.
- [x] **T3.2** — `channelErrorMessage(e)` en `webhook-shared.ts`, usado por
  `telegram-webhook.ts` y `whatsapp-webhook.ts`: el 402 explica el motivo real, cualquier
  otro fallo mantiene el genérico. Se conserva la respuesta `200` al proveedor.
  *Test:* unit de `channelErrorMessage` (402 → motivo; 500/Error → genérico). El `200` no
  se cubre con test nuevo porque no se modificó ese comportamiento.
- [x] **T3.3** — *(no previsto, hallazgo de seguridad durante la implementación)* La exención
  `isTest` era un **bypass** en `POST /api/chat`, que está en la allowlist pública
  (`public-routes.ts:21`): cualquiera enviaría `{publicKey, message, test: true}` y saltaría
  cupo y kill switch. El flag sólo se honra con `req.user` presente (el gate global resuelve
  la sesión también en rutas públicas).
  *Test:* sin sesión, `test: true` ⇒ `isTest = false` en el motor; con sesión ⇒ `true`.

## T4 — Inventario previo (gate operativo)

- [x] **T4.1** — `back/scripts/inventory-orphan-agents.ts`, **sólo lectura**: agentes con
  `tenantId = NULL` con nº de conversaciones totales y no-test, estado de instalación del
  widget, y lista de bloqueantes (tráfico real o widget instalado). `npm run
  inventory:orphans`. Sale con código 2 si hay bloqueantes.
  *Test:* no automatizable sin BD; typecheck verde y ejecución pendiente del gate T4.2.
- [x] **T4.2** — **HUMAN GATE — RESUELTO 27/07/2026.** Inventario ejecutado contra producción
  por el propietario. Resultado: **3 agentes huérfanos, los tres llamados "CRM EUROFORMACIA"**
  (`cmr5cu0570000...`, `cmr5nvged0000...`, `cmr5nzntx0003...`), creados el 03–04/07/2026;
  duplicados de pruebas de creación. Dos con 0 conversaciones, uno con 1 conversación real.
  **Ninguno con widget instalado en ningún sitio.**
  *Decisión del propietario:* son mocks; no se asigna tenant. El despliegue **no rompe ningún
  agente de cliente**: el fail-closed simplemente los deja inertes (402).
  *Verificación:* salida del inventario, arriba.
- [x] **T4.3** — *(derivado de T4.2)* `back/scripts/delete-orphan-agents.ts` +
  `npm run delete:orphans` para la limpieza opcional de los mocks. **Dry-run por defecto**;
  requiere `--apply`. Salvaguardas: sólo agentes con `tenantId = NULL`; re-comprobación del
  tenant dentro de la transacción (si alguien lo asigna mientras corre, no se borra); aborta
  si un `--id` no cumple el filtro en vez de borrar lo que sí encaja; salta los que tengan
  widget instalado salvo `--force`. Enumera lo que arrastra en cascada antes de tocar nada.
  `TokenUsage` **no** se ve afectado (`agentId` es escalar opcional sin relación a `Agent`),
  así que el histórico de consumo se conserva.
  *Test:* no automatizable sin BD; typecheck verde. **Ejecución en producción: sólo el
  propietario.** La limpieza es opcional y no bloquea el despliegue.

## T5 — Regresión de suites existentes

- [x] **T5.1** — Mocks de `@/lib/token-metering` actualizados en los 8 suites que lo
  simulaban (`vi.mock` sustituye el módulo entero ⇒ el export nuevo quedaba `undefined`):
  `agent-backend-tools`, `calificar-lead`, `chat-mode-and-latency`, `engine`,
  `notify-dispatcher`, `skill-instructions`, `telegram-webhook-openclaw`,
  `widget-install-ping`. (`telegram-webhook-pairing` no mockeaba el módulo.)
  *Test:* `npm test` completo verde en `back/`.

## T6 — Hallazgos de `sdd-verify` (27/07/2026)

- [x] **T6.1** — *(CRÍTICO para el intent)* **Cuarto llamador de `runAgent` sin contabilizar.**
  `src/lib/automations/engine.ts:114` (automatizaciones y cron) llama a `runAgent` directo:
  heredaba el gate, pero `deductTokens` vivía sólo en `chatWithAgent`, así que su consumo no
  incrementaba `tokensUsed` ni dejaba fila en `uso_tokens`. Un tenant que usara sólo
  automatizaciones consumía **ilimitado e invisible** — el mismo patrón que este change cierra,
  en su eje "sin registro", y habría dado a H4 datos de consumo falsos. Preexistente, no
  regresión. Corregido: `deductTokens` tras `runAgent`, con `operacion: "automation"` para
  distinguir el origen. `deductTokens` acepta ahora `conversationId: string | null` (la columna
  ya era opcional en el schema; la firma era más estricta de lo necesario y por eso este
  consumo no se podía registrar) y un `operacion?` opcional.
  *Test:* `tests/metering-automations.test.ts` → 4 casos (descuenta con `operacion`; sin tenant
  no descuenta; 0 tokens no descuenta; el 402 del gate queda en el `AutomationRun`).
- [x] **T6.2** — *(seguridad)* **`meteredTenantId` se filtraba al widget.** `chatWithAgent`
  devolvía `{...reply}` incluido el campo nuevo, y `POST /api/chat` — ruta **pública** —
  reenvía esa respuesta tal cual al widget embebido en el sitio del cliente. El id interno del
  tenant salía a cualquiera con la clave pública; antes no salía. Se elimina del retorno de
  `chatWithAgent` (cierra a todos los llamadores, presentes y futuros, en vez de parchear
  `ai.ts`).
  *Test:* la respuesta no tiene `meteredTenantId` y el cobro sí se hace contra el tenant real.
- [x] **T6.3** — *(seguridad)* **La exención `isTest` era demasiado ancha.** Saltaba
  `checkClientBalance` incluso con tenant asignado, así que la consola autenticada podía seguir
  atendiendo a un tenant con el kill switch activado — y `deductTokens` le seguía cargando el
  consumo. Ahora la exención es acotada: dispensa **sólo** del requisito de *tener tenant*; si
  hay tenant, cupo y kill switch se comprueban probando o no. Restaura el comportamiento previo
  de `ai.ts`, que comprobaba saldo con o sin `test`.
  *Test:* `assertUsageAllowed("tenant-1", {isTest: true})` con tenant inactivo ⇒ 402.
- [x] **T6.4** — `delete:orphans` exige `--id` o `--all` explícito para aplicar: `--apply` a
  secas ya no borra todos los huérfanos sin decirlo.
  *Test:* no automatizable sin BD; typecheck verde.

### Aceptado como deuda, fuera de alcance

- El sujeto de la exención `isTest` es "cualquier fila de `aa.User`", sin comprobar propiedad
  del agente ni rol. Hoy es correcto: `User` no tiene `tenantId` y los tres roles
  (`admin|editor|viewer`) son staff de la plataforma. Deja de serlo el día que exista login de
  cliente final → **H5 (portal cliente)** debe revisarlo.
- El principio de C.6 ("el kill switch corta el servicio, no sólo el gasto") no se extiende a
  las vías **sin LLM** de un tenant bloqueado: `/api/leads/kickoff`, `/api/booking/reserve`,
  `/api/public/leads`. No consumen tokens, así que no son un agujero de coste, pero un tenant
  impagado sigue recibiendo servicio por ahí → nota para **H3/H4**.

## Verificaciones finales

- [x] **V1** — `npx tsc --noEmit` verde en `back/`.
- [x] **V2** — `npm test` verde en `back/`: **102 ficheros, 1058 pasan, 3 skipped**
  (los 3 skips son preexistentes; antes del change: 99 ficheros, 1031 pasan, 3 skipped).
- [x] **V3** — Regresión cero en el camino feliz: los suites de los tres canales siguen verdes
  y `deductTokens` recibe los mismos argumentos que antes. **Precisión:** esos suites mockean
  `assertUsageAllowed` como pass-through, así que prueban la no-regresión, **no** el gate; el
  gate real (con `prisma` mockeado) sólo se ejercita en `tests/metering-fail-closed.test.ts`.
- [x] **V4** — Sin migración: `back/prisma/schema.prisma` y `back/prisma/migrations/` intactos.
- [x] **V5** — `sdd-verify` ejecutado (27/07/2026): **PASA para commit**, 4 hallazgos, los 4
  resueltos → T6. T4.2 resuelto por el propietario, así que el gate operativo del despliegue
  también está levantado.

## Orden crítico

```
T1 → T2 → T3 → T5 (verde) → T4.1 → [T4.2 HUMAN] → T6 (verify) → deploy fase 1
```

T4.1 puede escribirse en cualquier momento; **T4.2 bloquea el despliegue**, no el código.
La fase 2 (`tenantId` a `NOT NULL`) es un change posterior y no se aborda aquí.
