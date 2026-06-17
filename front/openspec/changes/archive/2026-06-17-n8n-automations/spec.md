# Spec — n8n-automations

Canal objetivo: **n8n**
Fecha: 2026-06-12
Estado: spec-ready
Fuente: `proposal.md` + código real (engine.ts, schema.prisma, AutomationsPanel.tsx).

---

## Resumen

Cada `Automation` se materializa como workflow real en n8n. n8n dispara el trigger
(schedule o webhook) y llama al backend (`POST /api/automations/:id/execute`), que
ejecuta el agente con el motor existente y registra un `AutomationRun`. Si n8n no
está configurado, el cron interno sigue funcionando sin cambio (fallback, no error).

---

## R1 — Cliente n8n REST (modo degradado)

**R1-1** El backend DEBE exponer un módulo `back/src/lib/n8n/client.ts` con operaciones
`createWorkflow`, `activateWorkflow`, `deactivateWorkflow`, `deleteWorkflow`, `getWorkflow`
contra `${N8N_BASE_URL}/api/v1/workflows` con header `X-N8N-API-KEY: ${N8N_API_KEY}`.

**R1-2** Si `N8N_BASE_URL` o `N8N_API_KEY` no están definidas en el entorno, el cliente
DEBE operar en modo noop: todas las operaciones resuelven sin error, devuelven `null`
para `workflowId`, y registran un warning en el log (`[n8n] N8N_BASE_URL not set – running in noop mode`).
El resto del sistema NO debe saber si n8n está activo o en noop.

**R1-3** Los errores de red de n8n (timeout, 5xx) NO deben propagar excepción al llamador
de las rutas de ciclo de vida (ver R4). Se capturan, se loguea el error con contexto
(`automationId`, operación) y se establece `syncStatus = "error"` en la fila.

**Escenarios R1:**

```
DADO que N8N_BASE_URL no está definido
CUANDO se crea una Automation
ENTONCES la fila se persiste con n8nWorkflowId = null y syncStatus = "pending" (sin n8n → modo fallback)
  Y el log incluye "[n8n] N8N_BASE_URL not set"
  Y la respuesta HTTP de POST /api/automations es 201 (no error)
```

```
DADO que N8N_BASE_URL está configurado y n8n responde 200
CUANDO se crea una Automation
ENTONCES n8nWorkflowId se persiste con el id devuelto por n8n
  Y syncStatus = "synced"
```

```
DADO que N8N_BASE_URL está configurado pero n8n está caído (timeout/5xx)
CUANDO se crea una Automation
ENTONCES la fila se persiste con n8nWorkflowId = null y syncStatus = "error"
  Y la respuesta HTTP de POST /api/automations es 201 (la operación local no falla)
```

---

## R2 — Generación de workflow en n8n

**R2-1** Al crear una `Automation`, el backend DEBE generar el JSON del workflow n8n
mediante una función `buildWorkflow(automation)` en `back/src/lib/n8n/workflow-builder.ts`
y llamar a `client.createWorkflow(json)`.

**R2-2** Para `trigger = "schedule"` el nodo trigger DEBE ser Schedule Trigger con
`intervalMinutes = config.intervalMinutes`. Si `config.intervalMinutes` no está
definido, el default es 5.

**R2-3** Para `trigger = "new_email"` o `trigger = "new_slack_message"` el nodo
trigger DEBE ser Webhook (HTTP, método POST). La URL del webhook queda registrada
en n8n; el evento real lo notifica el sistema externo (Gmail push / Slack Events,
fuera de alcance de esta fase — ver nota al final).

**R2-4** Todos los workflows DEBEN incluir un nodo HTTP Request configurado para
`POST ${BACK_URL}/api/automations/${automation.id}/execute` con header
`X-Automation-Secret: ${AUTOMATION_WEBHOOK_SECRET}`.

**R2-5** El JSON de workflow generado NO debe incluir credenciales OAuth internas
del backend (tokens de Gmail/Slack). El nodo Webhook de n8n solo recibe el evento;
la ejecución del agente ocurre en el backend.

**Escenarios R2:**

```
DADO trigger = "schedule" y config.intervalMinutes = 60
CUANDO buildWorkflow(automation) se ejecuta
ENTONCES el JSON resultante contiene un nodo de tipo "scheduleTrigger" con interval = 60 min
  Y contiene un nodo "httpRequest" con url = BACK_URL + /api/automations/:id/execute
  Y el header X-Automation-Secret está presente en el nodo httpRequest
```

```
DADO trigger = "new_email"
CUANDO buildWorkflow(automation) se ejecuta
ENTONCES el JSON contiene un nodo "webhook" (no schedule)
  Y contiene el nodo "httpRequest" con el mismo patrón
```

---

## R3 — Endpoint POST /api/automations/:id/execute

**R3-1** El endpoint DEBE estar protegido por secreto compartido: header
`X-Automation-Secret` obligatorio. Si ausente o incorrecto → `401 { error: "Unauthorized" }`.
El secreto se lee de la variable de entorno `AUTOMATION_WEBHOOK_SECRET`.

**R3-2** El endpoint DEBE extraer la lógica de ejecución individual a una función
`runAutomation(id: string)` en `back/src/lib/automations/engine.ts`, reutilizable
desde `runAutomations` (cron) y desde el endpoint `/execute`.

**R3-3** `runAutomation(id)` DEBE crear un registro `AutomationRun` (status ok|error|skipped,
summary, toolCalls) igual que hace hoy `runAutomations` para cada automation del lote.

**R3-4** El endpoint responde `200 { status, summary }` en caso de ejecución
correcta o skipped, y `200 { status: "error", summary: <mensaje> }` si el agente
lanza excepción (nunca 5xx al llamador n8n, para que n8n no reintente en bucle).

**R3-5** Si `automationId` no existe en base de datos → `404 { error: "Automation not found" }`.

**Escenarios R3:**

```
DADO que AUTOMATION_WEBHOOK_SECRET = "abc123"
CUANDO POST /api/automations/X/execute sin header X-Automation-Secret
ENTONCES respuesta 401
```

```
DADO que AUTOMATION_WEBHOOK_SECRET = "abc123"
CUANDO POST /api/automations/X/execute con X-Automation-Secret: "wrong"
ENTONCES respuesta 401
```

```
DADO que la automation X existe y tiene trigger = "schedule"
CUANDO POST /api/automations/X/execute con X-Automation-Secret correcto
ENTONCES runAutomation("X") se ejecuta
  Y se crea un AutomationRun con status ok|skipped|error
  Y responde 200 con { status, summary }
```

---

## R4 — Ciclo de vida: create / toggle / delete / edit

**R4-1 Crear:** `POST /api/automations` DEBE, tras persistir la fila, intentar
`n8nClient.createWorkflow` y guardar `n8nWorkflowId` + `syncStatus` en la misma
transacción lógica. Si n8n falla (noop o error de red): `n8nWorkflowId = null`,
`syncStatus = "error"` (o `"pending"` si noop), la fila se persiste, respuesta 201.

**R4-2 Toggle enabled:** `PATCH /api/automations` con `{ id, enabled }` DEBE llamar
`activateWorkflow` o `deactivateWorkflow` en n8n si `n8nWorkflowId` no es null.
Si n8n falla → `syncStatus = "error"`, operación local persiste el nuevo valor de `enabled`.

**R4-3 Borrar:** `DELETE /api/automations` DEBE llamar `n8nClient.deleteWorkflow(n8nWorkflowId)`
antes de borrar la fila. Si n8n responde 404 (workflow no existe) → continúa y borra
la fila local de todas formas. Si n8n falla con otro error → loguea y borra la fila
local de todas formas (evitar filas huérfanas).

**R4-4 404 en n8n al toggle/delete:** Si n8n devuelve 404 para `n8nWorkflowId` conocido,
el backend DEBE marcar `syncStatus = "error"` + `n8nWorkflowId = null` y operar localmente
(no abortar). La UI puede mostrar el botón de "Reintentar sync" (R6).

**R4-5 syncStatus válidos:** `"synced"` | `"pending"` | `"error"`.
- `synced`: n8n confirmó la operación.
- `pending`: n8n no configurado (noop).
- `error`: n8n configurado pero la última operación falló.

**Escenarios R4:**

```
DADO n8n configurado y n8nWorkflowId = "wf-42" y enabled = true
CUANDO PATCH /api/automations { id, enabled: false }
ENTONCES n8nClient.deactivateWorkflow("wf-42") se llama
  Y Automation.enabled = false persiste en DB
  Y syncStatus = "synced"
```

```
DADO n8nWorkflowId = "wf-42" y n8n responde 404
CUANDO DELETE /api/automations { id }
ENTONCES fila Automation se borra
  Y no se lanza error HTTP (responde 200 o 204)
```

```
DADO n8n caído (timeout)
CUANDO POST /api/automations (crear nueva)
ENTONCES Automation persiste con syncStatus = "error"
  Y respuesta 201 (no 5xx)
```

---

## R5 — Anti-duplicidad cron interno vs n8n

**R5-1** La función `runAutomations` (cron interno) DEBE omitir las automatizaciones
que tengan `n8nWorkflowId != null` Y `enabled = true` Y `syncStatus = "synced"`.
Estas las gestiona n8n; el cron no debe ejecutarlas.

**R5-2** Si `n8nWorkflowId = null` (n8n noop, error, o automation legacy), el cron
interno las ejecuta exactamente igual que hoy (sin cambio de comportamiento).

**R5-3** Las automatizaciones con `syncStatus = "error"` y `n8nWorkflowId = null`
son tratadas por el cron como si n8n no estuviera configurado (cron las ejecuta).

**Escenarios R5:**

```
DADO n8n configurado y Automation A tiene n8nWorkflowId = "wf-1" y syncStatus = "synced"
CUANDO runAutomations() (cron) se ejecuta
ENTONCES Automation A es OMITIDA por el cron (skip silencioso sin crear AutomationRun de "skipped")
```

```
DADO Automation B tiene n8nWorkflowId = null (legacy o noop)
CUANDO runAutomations() se ejecuta
ENTONCES Automation B se ejecuta normalmente por el cron
```

---

## R6 — UI: badge de modo y estado de sync

**R6-1** Cada tarjeta de automatización en `AutomationsPanel.tsx` DEBE mostrar un badge
de modo de ejecución: `"n8n"` si `n8nWorkflowId != null` y `syncStatus = "synced"`,
`"interno"` en cualquier otro caso.

**R6-2** Si `syncStatus = "error"`, la tarjeta DEBE mostrar un badge o icono de error
visible (p.ej. `⚠ Error sync`) junto al nombre de la automatización.

**R6-3** Con `syncStatus = "error"`, DEBE aparecer un botón o enlace `"Reintentar sync"`
que llame a un endpoint `POST /api/automations/:id/sync` (ver R6-5).

**R6-4** Si N8N_BASE_URL no está configurado (el backend lo puede indicar vía un campo
`n8nConfigured: boolean` en `GET /api/automations` o un endpoint de estado), la UI
DEBE mostrar un aviso discreto en el panel: `"n8n no configurado — las automatizaciones
usan el motor interno"`. No bloquea la creación de automatizaciones.

**R6-5** Endpoint `POST /api/automations/:id/sync`: reintenta la sincronización con n8n
(crear o actualizar workflow). Responde `200 { syncStatus }`. Requiere que el usuario
esté autenticado (misma auth que el resto de /api/automations). Este endpoint NO
requiere el header `X-Automation-Secret` (es llamado desde la UI, no desde n8n).

**R6-6** La interfaz de `Automation` que expone la API DEBE incluir los campos:
`n8nWorkflowId: string | null`, `syncStatus: "synced" | "pending" | "error"`.

**Escenarios R6:**

```
DADO Automation con n8nWorkflowId = "wf-1" y syncStatus = "synced"
CUANDO AutomationsPanel renderiza la tarjeta
ENTONCES se muestra el badge "n8n"
  Y no se muestra el badge de error
```

```
DADO Automation con syncStatus = "error"
CUANDO AutomationsPanel renderiza la tarjeta
ENTONCES se muestra el badge "interno"
  Y se muestra badge/icono de error "⚠ Error sync"
  Y se muestra botón "Reintentar sync"
```

```
DADO n8n no configurado (campo n8nConfigured = false en respuesta de la API)
CUANDO AutomationsPanel se monta
ENTONCES aparece aviso "n8n no configurado — las automatizaciones usan el motor interno"
  Y el botón de crear automatización sigue activo (no bloqueado)
```

---

## R7 — Infraestructura: docker-compose y variables de entorno

**R7-1** El archivo `docker-compose.yml` (raíz del repo) DEBE documentar un servicio
`n8n` opcional mediante perfil (`profiles: ["n8n"]`) o bloque comentado, con imagen
oficial `n8nio/n8n`, puerto `5678`, volumen persistente y variable `N8N_BASIC_AUTH_*`.
No debe ser servicio por defecto (no rompe el stack actual si no se activa).

**R7-2** El archivo `back/.env.example` DEBE incluir las siguientes variables:
```
N8N_BASE_URL=          # URL base de n8n, ej. http://localhost:5678
N8N_API_KEY=           # API key generada en n8n (Settings > API)
BACK_URL=              # URL pública del backend (para el nodo HTTP Request del workflow)
AUTOMATION_WEBHOOK_SECRET=  # Secreto compartido para autenticar POST /execute desde n8n
```

**R7-3** Las variables `N8N_BASE_URL`, `N8N_API_KEY` y `AUTOMATION_WEBHOOK_SECRET`
son opcionales para arrancar el servidor (modo noop si ausentes). Si
`AUTOMATION_WEBHOOK_SECRET` está ausente al recibir un request en `/execute`,
el endpoint devuelve `500 { error: "AUTOMATION_WEBHOOK_SECRET not configured" }`.

**Escenarios R7:**

```
DADO que docker-compose.yml existe
CUANDO se ejecuta `docker compose up` (sin perfil n8n)
ENTONCES el servicio n8n NO arranca (perfil no activado)
  Y el resto del stack arranca normalmente
```

```
DADO que docker-compose.yml existe
CUANDO se ejecuta `docker compose --profile n8n up`
ENTONCES el servicio n8n arranca en puerto 5678
```

---

## R8 — Esquema de datos

**R8-1** El modelo `Automation` en `schema.prisma` DEBE añadir:
- `n8nWorkflowId  String?`
- `syncStatus     String  @default("pending")` — valores válidos: `synced | pending | error`

**R8-2** La migración DEBE ser un archivo SQL manual `back/prisma/migrate-automation-n8n.sql`
con `ALTER TABLE "Automation" ADD COLUMN "n8nWorkflowId" TEXT` y
`ALTER TABLE "Automation" ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'pending'`.
La migración es no destructiva (columnas nullable/default). Rollback:
`ALTER TABLE "Automation" DROP COLUMN ...`.

**R8-3** Las automatizaciones existentes (legacy) quedan con `n8nWorkflowId = null`
y `syncStatus = "pending"` tras la migración. El cron las ejecuta (R5-2). No requiere
backfill manual.

---

## Casos borde explícitos

| Situación | Comportamiento esperado |
|---|---|
| n8n caído al crear Automation | Automation persiste, syncStatus=error, respuesta 201 |
| n8n caído al toggle enabled | enabled persiste en DB, syncStatus=error, respuesta 200 |
| n8n caído al delete | Fila borrada, log de error, respuesta 200/204 |
| Workflow borrado manualmente en n8n (404 al toggle) | n8nWorkflowId=null, syncStatus=error, UI muestra "Reintentar sync" |
| POST /execute sin AUTOMATION_WEBHOOK_SECRET configurado | 500 con mensaje de config |
| POST /execute con secreto incorrecto | 401 |
| POST /execute con automation inexistente | 404 |
| runAutomations (cron) con automation synced en n8n | Skip silencioso (no AutomationRun) |
| buildWorkflow con trigger desconocido | Lanza error en tiempo de construcción (no llega a n8n) |
| config.intervalMinutes = undefined con trigger=schedule | Default 5 minutos en el nodo trigger |

---

## Nota: triggers de evento (new_email / new_slack_message)

Los nodos Webhook de n8n para `new_email` y `new_slack_message` reciben el evento
cuando algo notifica a n8n. La integración de Gmail watch y Slack Events API
(registro del endpoint de n8n como destino push) está **fuera de alcance** de esta
fase y depende de `oauth-integrations`. En esta fase se genera el nodo Webhook
correcto en el workflow, pero la activación del push externo es responsabilidad del
operador o de una fase posterior. El cron interno cubre estos triggers mientras tanto.

---

## Variables de entorno nuevas (resumen)

| Variable | Requerida para n8n | Default si ausente |
|---|---|---|
| `N8N_BASE_URL` | Sí | noop (cron interno) |
| `N8N_API_KEY` | Sí | noop (cron interno) |
| `AUTOMATION_WEBHOOK_SECRET` | Sí para /execute | 500 en /execute |
| `BACK_URL` | Sí para buildWorkflow | Usar existente o localhost |

---

## Archivos afectados (previsión, no normativa)

**Back (nuevo):**
- `back/src/lib/n8n/client.ts`
- `back/src/lib/n8n/workflow-builder.ts`
- `back/prisma/migrate-automation-n8n.sql`

**Back (modificado):**
- `back/prisma/schema.prisma` — añadir campos R8-1
- `back/src/lib/automations/engine.ts` — extraer `runAutomation(id)`; skip R5-1
- `back/src/index.ts` — endpoint /execute (R3), endpoint /sync (R6-5), wiring ciclo de vida (R4)
- `back/.env.example` — variables nuevas (R7-2)

**Front (modificado):**
- `front/components/AutomationsPanel.tsx` — badges modo/sync, aviso n8n no configurado, botón reintentar

**Infra:**
- `docker-compose.yml` — servicio n8n opcional (R7-1)
