# Spec — n8n Automations

**Estado**: Archived from P3 — n8n-automations (2026-06-12)

**Objetivo**: Materializar automatizaciones como workflows reales en n8n (cliente REST, trigger schedule/webhook → HTTP Request a `/api/automations/:id/execute`).

---

## R1 — Cliente n8n REST (modo degradado)

El backend DEBE exponer un módulo `back/src/lib/n8n/client.ts` con operaciones contra `${N8N_BASE_URL}/api/v1/workflows` con header `X-N8N-API-KEY`.

**R1-1 — Operaciones del cliente**

```
MUST soportar: createWorkflow, activateWorkflow, deactivateWorkflow, deleteWorkflow, getWorkflow
Contra: ${N8N_BASE_URL}/api/v1/workflows con header X-N8N-API-KEY
```

**R1-2 — Modo noop si n8n no configurado**

```
GIVEN que N8N_BASE_URL o N8N_API_KEY no están definidas
WHEN el backend intenta operar
THEN el cliente DEBE operar en modo noop:
     todas las operaciones resuelven sin error
     devuelven null para workflowId
     registran un warning en el log
 AND el resto del sistema NO debe saber si n8n está activo o en noop
```

**R1-3 — Manejo de errores de red**

```
GIVEN que N8N_BASE_URL está configurado pero n8n está caído (timeout, 5xx)
WHEN ocurre un error de red durante createWorkflow
THEN el error NO propaga excepción al llamador de las rutas de ciclo de vida
 AND se captura, se loguea con contexto (automationId, operación)
 AND se establece syncStatus = "error" en la fila
```

**Escenarios R1**

```
DADO N8N_BASE_URL no está definido
CUANDO se crea una Automation
ENTONCES la fila se persiste con n8nWorkflowId = null y syncStatus = "pending"
  Y el log incluye "[n8n] N8N_BASE_URL not set"
  Y la respuesta HTTP es 201 (no error)

DADO N8N_BASE_URL está configurado y n8n responde 200
CUANDO se crea una Automation
ENTONCES n8nWorkflowId se persiste con el id devuelto
  Y syncStatus = "synced"

DADO N8N_BASE_URL configurado pero n8n caído
CUANDO se crea una Automation
ENTONCES la fila se persiste con n8nWorkflowId = null y syncStatus = "error"
  Y la respuesta HTTP es 201
```

---

## R2 — Generación de workflow en n8n

Al crear una `Automation`, el backend DEBE generar el JSON del workflow n8n mediante `buildWorkflow(automation)` en `back/src/lib/n8n/workflow-builder.ts` y llamar a `client.createWorkflow(json)`.

**R2-1 — Trigger schedule**

```
GIVEN trigger = "schedule" y config.intervalMinutes = 60
WHEN buildWorkflow(automation) se ejecuta
THEN el JSON resultante contiene un nodo Schedule Trigger con interval = 60 min
```

**R2-2 — Trigger webhook**

```
GIVEN trigger = "new_email" o trigger = "new_slack_message"
WHEN buildWorkflow(automation) se ejecuta
THEN el JSON contiene un nodo Webhook (HTTP, método POST)
```

**R2-3 — Nodo HTTP Request**

```
DADO cualquier trigger
CUANDO buildWorkflow genera el JSON
ENTONCES todos los workflows DEBEN incluir un nodo HTTP Request configurado para:
     POST ${BACK_URL}/api/automations/${automation.id}/execute
     con header X-Automation-Secret: ${AUTOMATION_WEBHOOK_SECRET}
```

**R2-4 — Protección de credenciales**

```
GIVEN el JSON de workflow generado
WHEN se envía a n8n
THEN NO debe incluir credenciales OAuth internas del backend
 AND el nodo Webhook de n8n solo recibe el evento
 AND la ejecución del agente ocurre en el backend
```

**R2-5 — Default interval**

```
GIVEN config.intervalMinutes no está definido
WHEN buildWorkflow genera el nodo Schedule
THEN el default es 5 minutos
```

---

## R3 — Refactor del motor de ejecución

Extraer `runAutomation(id)` desde `runAutomations` en `back/src/lib/automations/engine.ts` (una sola automatización, crea `AutomationRun`).

**R3-1 — Función runAutomation**

```
GIVEN una Automation con id=A1
WHEN se llama runAutomation(id)
THEN la función:
     busca la Automation por id
     valida si debe ejecutarse (enabled, trigger match)
     llama runAgent si procede
     crea un AutomationRun con resultado
     devuelve el resultado
```

**R3-2 — runAutomations refactorizado**

```
GIVEN que runAutomations existía como función monolítica
WHEN se refactoriza en sdd-apply
THEN pasa a iterar sobre Automations y llamar runAutomation(id) por cada una
```

---

## R4 — Endpoint de ejecución y wiring de ciclo de vida

**R4-1 — Endpoint POST /api/automations/:id/execute**

```
GIVEN una petición autenticada por secreto compartido
WHEN se llama POST /api/automations/:id/execute
THEN:
     valida el header X-Automation-Secret
     busca la Automation por id
     llama runAutomation(id)
     devuelve resultado con status HTTP 200 o error
```

**R4-2 — Ciclo de vida: crear**

```
GIVEN el usuario crea una Automation via POST /api/automations
WHEN la fila Automation se persiste en la base de datos
THEN:
     createWorkflow(automation) es llamada
     n8nWorkflowId se persiste (o null si n8n no está configurado)
     syncStatus se establece según el resultado de createWorkflow
     si falla la creación en n8n, la fila se persiste pero con syncStatus="error"
```

**R4-3 — Ciclo de vida: toggle enabled**

```
GIVEN una Automation con enabled=true
WHEN se ejecuta PATCH /api/automations con enabled=false
THEN:
     activateWorkflow o deactivateWorkflow se llama en n8n
     la Automation se actualiza localmente
```

**R4-4 — Ciclo de vida: delete**

```
GIVEN una Automation que será eliminada
WHEN se ejecuta DELETE /api/automations/:id
THEN:
     deleteWorkflow(n8nWorkflowId) se llama en n8n
     la fila Automation se borra de la base de datos
```

---

## R5 — Infraestructura

**R5-1 — Servicio n8n opcional en docker-compose.yml**

```
GIVEN el usuario quiere desplegar n8n localmente
WHEN consulta docker-compose.yml
THEN:
     existe un servicio n8n comentado o bajo un perfil
     contiene instrucciones inline para arrancar
     documentadas: configuración de API key y BASE_URL
```

---

## R6 — Frontend

**R6-1 — Indicadores de estado en UI**

```
GIVEN una Automation renderizada en AutomationsPanel
WHEN el usuario ve el item de automatización
THEN:
     muestra badge ⚙️ para "n8n" (si syncStatus = "synced")
     muestra badge 🕐 para "internal" (si no synced o no configurado)
     muestra badge ⚠ "Error sync" si syncStatus = "error"
     muestra botón "Reintentar"
```

**R6-2 — Manejo de n8n no configurado**

```
GIVEN que N8N_BASE_URL no está configurado
WHEN la UI carga las automatizaciones
THEN:
     muestra banner informativo
     no bloquea la creación/uso de automatizaciones (fallback a cron interno)
```

---

## R7 — Tests

**R7-1 — Vitest del builder por trigger**

```
GIVEN cada tipo de trigger (schedule, new_email, new_slack_message)
WHEN se ejecutan los tests de buildWorkflow
THEN:
     el JSON generado tiene la estructura correcta
     cada trigger se mapea al nodo correcto
     el nodo HTTP Request está presente y bien configurado
```

**R7-2 — Vitest del cliente n8n**

```
GIVEN el cliente n8n mockeado (ok, 404, red caída)
WHEN se ejecutan los tests
THEN:
     createWorkflow con respuesta 200 devuelve workflowId
     fallo de red establece syncStatus = "error" y no lanza excepción
     modo noop funciona sin n8n configurado
```

**R7-3 — Vitest de auth del endpoint /execute**

```
GIVEN el endpoint POST /api/automations/:id/execute
WHEN se ejecutan los tests
THEN:
     header X-Automation-Secret válido permite ejecución
     header ausente o inválido devuelve HTTP 403
     (Actualmente solo asserts booleanos inline; P3 requiere supertest real)
```

---

## Casos borde

**CB-1 — Intervalo schedule inválido**

```
GIVEN config.intervalMinutes = 0 o negativo
WHEN buildWorkflow se ejecuta
THEN:
     lanza error claro
     no se persiste la Automation
```

**CB-2 — Trigger desconocido**

```
GIVEN trigger = "unknown_trigger"
WHEN buildWorkflow se ejecuta
THEN:
     lanza Error
     no llega a n8n
     la Automation NO se persiste
```

**CB-3 — Automation eliminada, webhook activo en n8n**

```
GIVEN una Automation eliminada localmente pero su workflow aún existe en n8n
WHEN n8n intenta disparar el webhook
THEN:
     POST /api/automations/:id/execute devuelve 404
     n8n recibe 404 y maneja el error según su lógica
```

---

## Decision — syncStatus

**Valores permitidos para `syncStatus`**:

- `"pending"` — n8n no está configurado o aún no se ha intentado crear
- `"synced"` — workflow creado y activo en n8n
- `"error"` — último intento de crear/activar falló en n8n
- `"local"` — fallback: sin n8n, usa cron interno

**Política**: solo `schedule` se marca `syncStatus="synced"` (lo dispara n8n). `new_email`/`new_slack_message` se crean en n8n pero el cron interno sigue ejecutándolos (no marcar synced) hasta que exista el push externo.

---

## Technical Debt

**P4 — Test coverage**

- [ ] Test unitario de `runAutomation` (mock `runAgent`).
  - Actualmente: solo asserts booleanos de lógica de skip.
  - Required: mockear Prisma / `runAgent` y ejecutar reales.
  - Estimated effort: 12h. Priority: medium.

- [ ] Supertest para auth del endpoint `/execute`.
  - Actualmente: simulación inline en vitest.
  - Required: ejercitar extracción de header, lookup Prisma, flujo `runAutomation` → `res.json()`.
  - Estimated effort: 8h. Priority: medium.

- [ ] Playwright para crear automatización y ver estado (mock).
  - Estimated effort: 16h. Priority: low (deferred to integration testing).

---

## Implementation Status

- [x] Schema Automation: `n8nWorkflowId String?`, `syncStatus` (implicit in implementation)
- [x] Cliente n8n REST (modo noop)
- [x] Builder workflow (schedule, webhooks, HTTP Request nodo)
- [x] Endpoint POST /api/automations/:id/execute
- [x] Ciclo de vida: create, toggle enabled, delete
- [x] Docker-compose con servicio n8n
- [x] Frontend: badges y estado de sincronización
- [x] Vitest: builder, client, auth (100/100 tests)
- [ ] Test unitario de `runAutomation` con mocks (P4)
- [ ] Supertest para `/execute` (P4)
- [ ] Playwright e2e (P4)
