# Design — n8n-automations

Canal objetivo: **n8n**
Fecha: 2026-06-12
Estado: design-ready
Fuente: `proposal.md` + `spec.md` (spec-ready) + código real (engine.ts, schema.prisma `Automation`, endpoints `/api/automations` en index.ts, `channels/dedup.ts`, `AutomationsPanel.tsx`).

---

## 0. Decisiones de arquitectura (ADR resumido)

| ID | Decisión | Alternativa rechazada | Razón |
|---|---|---|---|
| AD1 | n8n **opcional**: sin `N8N_BASE_URL` o `N8N_API_KEY` → cliente en modo noop, fallback silencioso al cron interno actual. No es error. | Rechazar creación de automatización si n8n no está | Spec R1-2/R5-2. El stack debe arrancar y operar sin n8n. El cron interno (`runAutomations`) ya existe y cubre todos los triggers. n8n es una mejora, no un requisito. |
| AD2 | Cliente n8n en `back/src/lib/n8n/client.ts`; generación de JSON en `back/src/lib/n8n/workflow-builder.ts`; refactor de motor en `automations/engine.ts`. **Sin router nuevo**: las rutas `/api/automations` ya viven inline en `index.ts` (líneas 538-552), se amplían ahí. | Extraer a `routes/automations.ts` | A diferencia de P1 (channels, 8 endpoints), aquí se añaden 2 rutas (`/:id/execute`, `/:id/resync`) y hooks a 3 existentes. El crecimiento de `index.ts` es ~80 líneas. Mantener inline evita un refactor de montaje no pedido. Vigilar el límite de 500 líneas; si se excede, extraer en fase posterior. |
| AD3 | Extraer `runAutomation(id)` de `runAutomations` (engine.ts). El cron itera y llama `runAutomation`; el endpoint `/execute` lo reusa. | Duplicar la lógica de ejecución en el endpoint | Spec R3-2. La lógica por-automatización (validación de provider, construcción de mensaje, `runAgent`, `AutomationRun`, `lastRunAt`) es idéntica. DRY + un solo punto de cambio. |
| AD4 | Anti-duplicidad: el cron **salta** automatizaciones con `n8nWorkflowId != null` AND `enabled = true` AND `syncStatus = "synced"`. Skip silencioso, **sin** crear `AutomationRun` de "skipped". | Crear `AutomationRun` "skipped" por cada skip de n8n | Spec R5-1. Esas las dispara n8n vía `/execute`; un "skipped" del cron ensuciaría el historial con ruido constante cada 5 min. El skip es invisible. |
| AD5 | Dos columnas nuevas en `Automation`: `n8nWorkflowId String?` y `syncStatus String @default("pending")` (`synced`/`pending`/`error`). Migración SQL manual no destructiva. | `metadata` JSON con `{ n8nWorkflowId, syncStatus }` | Spec R8-1. Explícito, consultable e indexable. El cron filtra por `syncStatus`/`n8nWorkflowId` en la query `findMany`; con JSON requeriría parsear en memoria. Espeja AD5 de `oauth-integrations` (columna `status` explícita sobre `metadata`). |
| AD6 | Sync con n8n **best-effort**: el ciclo de vida (create/toggle/delete) persiste SIEMPRE la operación local; el fallo de n8n solo fija `syncStatus="error"`, nunca propaga 5xx al cliente. | Transacción atómica DB↔n8n con rollback | Spec R1-3/R4. n8n es un sistema externo que puede caer; no debe bloquear la gestión de automatizaciones. La UI muestra `syncStatus=error` + botón "Reintentar sync" (R6). Reconciliación manual, no atómica. |
| AD7 | Endpoint `/execute` autenticado por **header `X-Automation-Secret`** == env `AUTOMATION_WEBHOOK_SECRET`. Mismatch/ausente → **401**; secret no configurado en servidor → **500**. | Sin auth / IP allowlist | Spec R3-1/R7-3. n8n llama desde fuera; sin secreto cualquiera podría disparar agentes (coste LLM + side effects de tools). 401 para credencial inválida (semántica HTTP correcta); 500 para mala configuración del servidor. **Nota discrepancia:** la orquestación mencionó 403; se usa 401 (spec R3-1) por corrección semántica. |
| AD8 | Endpoint de reintento manual = **`POST /api/automations/:id/resync`** (auth de usuario, NO requiere `X-Automation-Secret`). | `POST /api/automations/:id/sync` (nombre del spec R6-5) | Lo llama la UI, no n8n. **Discrepancia spec↔orquestación:** spec dice `/sync`, la orquestación fija `/resync`. Se usa `/resync` (decisión de orquestación); la UI y este diseño quedan alineados. Documentado en §10. |
| AD9 | `/execute` y `/resync` usan **path param `:id`** (n8n construye una URL fija por workflow). Las rutas existentes create/patch/delete siguen con `id` en **body** (no se tocan sus contratos). | Migrar todas a path param | Las rutas actuales (`PATCH`/`DELETE /api/automations` con `{ id }` en body) las consume `AutomationsPanel.tsx` (líneas 196-202). Cambiarlas rompería el front sin necesidad. Solo las rutas nuevas, que llama n8n/UI con id conocido, usan `:id`. |

---

## 1. Arquitectura de módulos backend

```
back/src/
  index.ts                       # +2 rutas (/:id/execute, /:id/resync), hooks en POST/PATCH/DELETE
  lib/
    n8n/
      client.ts                  # wrapper REST n8n + isConfigured() + modo noop
      workflow-builder.ts        # buildWorkflow(automation) → JSON n8n v1
      types.ts                   # tipos N8nWorkflow / N8nNode / SyncResult
    automations/
      engine.ts                  # runAutomation(id) extraído; runAutomations itera + skip R5-1
  prisma/
    schema.prisma                # Automation += n8nWorkflowId, syncStatus
    migrate-automation-n8n.sql   # ADD COLUMN (no destructiva)
```

Responsabilidades (SRP):

- **`n8n/client.ts`** — sin Prisma ni Express. Wrapper `fetch` sobre `${N8N_BASE_URL}/api/v1/workflows` con header `X-N8N-API-KEY`. Expone `isConfigured()`. Captura errores de red/HTTP y los traduce a `SyncResult` (no lanza al llamador de rutas). No conoce el modelo `Automation`.
- **`n8n/workflow-builder.ts`** — función pura `buildWorkflow(automation)` → JSON n8n. Sin I/O. Determinista y testeable en aislamiento. No incluye credenciales OAuth (R2-5).
- **`automations/engine.ts`** — `runAutomation(id)` (una automatización: valida provider, construye mensaje, `runAgent`, crea `AutomationRun`, actualiza `lastRunAt`); `runAutomations()` itera filas elegibles y aplica skip R5-1.
- **`index.ts`** — orquesta: tras persistir la fila llama al cliente n8n best-effort y actualiza `syncStatus`. Única capa que toca Prisma para el ciclo de vida.

> El cliente n8n NO usa el patrón TTL de `channels/dedup.ts` (no hay idempotencia de eventos aquí). Se referencia dedup.ts solo como ejemplo de módulo `lib/` sin estado externo y testeable.

---

## 2. Módulo `n8n/client.ts`

### 2.1 Contrato

```ts
// back/src/lib/n8n/client.ts
import type { N8nWorkflow } from "./types";

export interface SyncResult {
  ok: boolean;                 // true si la operación n8n tuvo éxito
  workflowId: string | null;   // id devuelto por n8n, o null (noop / error / 404)
  status: "synced" | "pending" | "error";  // mapea a Automation.syncStatus
  notFound?: boolean;          // true si n8n respondió 404 (workflow inexistente)
}

/** true sólo si N8N_BASE_URL y N8N_API_KEY están definidas. */
export function isConfigured(): boolean;

export async function createWorkflow(wf: N8nWorkflow): Promise<SyncResult>;
export async function updateWorkflow(workflowId: string, wf: N8nWorkflow): Promise<SyncResult>;
export async function activateWorkflow(workflowId: string): Promise<SyncResult>;
export async function deactivateWorkflow(workflowId: string): Promise<SyncResult>;
export async function deleteWorkflow(workflowId: string): Promise<SyncResult>;
export async function getWorkflow(workflowId: string): Promise<SyncResult>;
```

### 2.2 Comportamiento (R1)

- **noop (R1-2):** si `!isConfigured()` toda operación devuelve `{ ok: true, workflowId: null, status: "pending" }` y loguea **una vez** `"[n8n] N8N_BASE_URL not set – running in noop mode"`. El resto del sistema no distingue noop de éxito (sólo mira `status`).
- **n8n REST endpoints n8n v1:**
  - crear: `POST ${N8N_BASE_URL}/api/v1/workflows` → 200 con `{ id }` → `{ ok: true, workflowId: id, status: "synced" }`.
  - actualizar: `PUT /api/v1/workflows/{id}`.
  - activar: `POST /api/v1/workflows/{id}/activate`.
  - desactivar: `POST /api/v1/workflows/{id}/deactivate`.
  - borrar: `DELETE /api/v1/workflows/{id}`.
  - leer: `GET /api/v1/workflows/{id}`.
  - Header en todas: `X-N8N-API-KEY: ${N8N_API_KEY}`, `Content-Type: application/json`.
- **404 (R4-4):** si n8n responde 404 para un `workflowId` conocido → `{ ok: false, workflowId: null, status: "error", notFound: true }`. El llamador trata `notFound` distinto de error de red (ej. al borrar, continúa).
- **Error de red / 5xx / timeout (R1-3):** captura, loguea con contexto (`operación`, `workflowId`), devuelve `{ ok: false, workflowId: null, status: "error" }`. **Nunca relanza** — las rutas no deben caer por culpa de n8n.
- Timeout recomendado: `AbortController` con 10s (n8n puede tardar en cargar workflows grandes).

---

## 3. Módulo `n8n/workflow-builder.ts`

### 3.1 Contrato

```ts
// back/src/lib/n8n/workflow-builder.ts
import type { N8nWorkflow } from "./types";

/**
 * Traduce una Automation a un workflow n8n (trigger + HTTP Request al backend).
 * trigger ∈ { schedule, new_email, new_slack_message }.
 * Lanza si trigger es desconocido (no debe llegar a n8n).
 */
export function buildWorkflow(automation: {
  id: string;
  name: string;
  trigger: string;
  config: { intervalMinutes?: number } | null;
}): N8nWorkflow;
```

Lee env en construcción:
- `BACK_URL` para el nodo HTTP Request. Resolución de URL pública: `process.env.PUBLIC_URL || process.env.BACK_URL || "http://localhost:4000"` (PUBLIC_URL ya existe de P1 telegram-whatsapp para webhooks; preferida porque n8n debe alcanzar el backend públicamente).
- `AUTOMATION_WEBHOOK_SECRET` para el header del HTTP Request.

### 3.2 Reglas por trigger (R2)

| `trigger` | Nodo trigger | Parámetro |
|---|---|---|
| `schedule` | `scheduleTrigger` | `intervalMinutes = config.intervalMinutes ?? 5` (R2-2, default 5) |
| `new_email` | `webhook` (POST) | path = `automation-{id}`; el push externo lo activa Gmail watch (fuera de alcance) |
| `new_slack_message` | `webhook` (POST) | path = `automation-{id}` |
| otro | — | **lanza `Error("unknown trigger")`** (caso borde spec) |

Todos los workflows incluyen, conectado al trigger, un nodo **HTTP Request** (R2-4):
- método `POST`
- url `${PUBLIC_URL||BACK_URL}/api/automations/${automation.id}/execute`
- header `X-Automation-Secret: ${AUTOMATION_WEBHOOK_SECRET}`

### 3.3 Ejemplo real de JSON n8n (v1) — trigger `schedule`, intervalMinutes = 60

```json
{
  "name": "Automation Emails urgentes (auto-cm3x9...)",
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            { "field": "minutes", "minutesInterval": 60 }
          ]
        }
      },
      "id": "trigger-node",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.1,
      "position": [260, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.ejemplo.com/api/automations/cm3x9.../execute",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "X-Automation-Secret", "value": "={{ $env.AUTOMATION_WEBHOOK_SECRET }}" }
          ]
        },
        "options": { "timeout": 60000 }
      },
      "id": "http-node",
      "name": "Call Backend Execute",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [480, 300]
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [
        [ { "node": "Call Backend Execute", "type": "main", "index": 0 } ]
      ]
    }
  },
  "settings": { "executionOrder": "v1" }
}
```

> El header `X-Automation-Secret` se inyecta como literal en build-time (`AUTOMATION_WEBHOOK_SECRET` resuelto en el backend) o como `={{ $env.AUTOMATION_WEBHOOK_SECRET }}` si n8n tiene la env. Decisión de implementación: **literal en build-time** es más simple (n8n no necesita conocer la env); el ejemplo muestra ambas formas, se usa el literal. Documentar que rotar el secreto exige re-sync de todos los workflows.

### 3.4 Ejemplo trigger `new_email` (nodo Webhook)

```json
{
  "name": "Automation Clasifica emails (auto-cm4y2...)",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "automation-cm4y2...",
        "responseMode": "onReceived"
      },
      "id": "trigger-node",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [260, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.ejemplo.com/api/automations/cm4y2.../execute",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "X-Automation-Secret", "value": "SECRET_INJECTED_AT_BUILD" }
          ]
        }
      },
      "id": "http-node",
      "name": "Call Backend Execute",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [480, 300]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [ [ { "node": "Call Backend Execute", "type": "main", "index": 0 } ] ]
    }
  },
  "settings": { "executionOrder": "v1" }
}
```

`new_slack_message` es idéntico a `new_email` salvo el `path` (`automation-{id}`); ambos generan el mismo patrón Webhook → HTTP Request.

---

## 4. Refactor de `engine.ts`

Extraer la lógica del cuerpo del `for` actual (líneas 19-94) a una función:

```ts
// back/src/lib/automations/engine.ts

/** Ejecuta una sola automatización: valida provider, corre el agente, crea AutomationRun. */
export async function runAutomation(id: string): Promise<{ status: string; summary: string }> {
  const automation = await prisma.automation.findUnique({
    where: { id },
    include: { agent: { include: { integrations: { select: { provider: true, status: true } } } } },
  });
  if (!automation) return { status: "error", summary: "Automation not found" };
  // ... (lógica idéntica actual: providerStatus, triggerContext, runAgent,
  //      AutomationRun.create, automation.update lastRunAt) ...
  return { status, summary };
}

export async function runAutomations() {
  const automations = await prisma.automation.findMany({
    where: { enabled: true },
    select: { id: true, n8nWorkflowId: true, syncStatus: true, name: true },
  });
  const results = [];
  for (const a of automations) {
    // R5-1: las que gestiona n8n se saltan sin AutomationRun
    if (a.n8nWorkflowId && a.syncStatus === "synced") continue;
    const r = await runAutomation(a.id);
    results.push({ automation: a.name, status: r.status, summary: r.summary.slice(0, 200) });
  }
  return results;
}
```

Notas:
- `runAutomation(id)` recarga la fila con su `include` (antes el `include` venía del `findMany`). Coste: una query extra por automatización del cron. Aceptable (volumen bajo); evita duplicar el `include` y mantiene `runAutomation` autosuficiente para el endpoint `/execute`.
- El skip R5-1 se evalúa en `runAutomations` con los campos `n8nWorkflowId`/`syncStatus` ya en el `select` (sin segunda query).
- `runAutomation` devuelve `{ status, summary }`; el endpoint `/execute` lo serializa directo.

---

## 5. Hooks de ciclo de vida en `index.ts` (R4)

Las 3 rutas existentes ganan un paso n8n **best-effort** tras la operación local. Pseudo-flujo:

### 5.1 `POST /api/automations` (crear) — R4-1

```ts
const automation = await prisma.automation.create({ data: parsed.data });
const wf = buildWorkflow(automation);
const r = await n8n.createWorkflow(wf);          // noop|synced|error, nunca lanza
if (r.status === "synced" && automation.enabled) {
  await n8n.activateWorkflow(r.workflowId!);     // activar si enabled
}
await prisma.automation.update({
  where: { id: automation.id },
  data: { n8nWorkflowId: r.workflowId, syncStatus: r.status },
});
res.status(201).json({ ...automation, n8nWorkflowId: r.workflowId, syncStatus: r.status });
```
Resultado: noop → `syncStatus="pending"`, n8n caído → `"error"`, ok → `"synced"`. Siempre **201** (R1 escenarios).

### 5.2 `PATCH /api/automations` (toggle enabled) — R4-2

```ts
const updated = await prisma.automation.update({ where: { id }, data: { enabled } });
let syncStatus = updated.syncStatus;
if (updated.n8nWorkflowId) {
  const r = enabled
    ? await n8n.activateWorkflow(updated.n8nWorkflowId)
    : await n8n.deactivateWorkflow(updated.n8nWorkflowId);
  if (r.notFound) {                              // R4-4: workflow borrado en n8n
    await prisma.automation.update({ where: { id }, data: { n8nWorkflowId: null, syncStatus: "error" } });
    syncStatus = "error";
  } else {
    syncStatus = r.status;
    await prisma.automation.update({ where: { id }, data: { syncStatus } });
  }
}
res.json({ ...updated, syncStatus });
```
El `enabled` persiste siempre; n8n es secundario (R4-2).

### 5.3 `DELETE /api/automations` (borrar) — R4-3

```ts
const automation = await prisma.automation.findUnique({ where: { id } });
if (automation?.n8nWorkflowId) {
  await n8n.deleteWorkflow(automation.n8nWorkflowId);  // 404 o error → se ignora, log
}
await prisma.automation.delete({ where: { id } });
res.json({ ok: true });
```
La fila local se borra **siempre** (evitar huérfanas), responda lo que responda n8n (R4-3).

---

## 6. Contratos de los endpoints nuevos

### 6.1 `POST /api/automations/:id/execute` (R3) — lo llama n8n

Auth: header `X-Automation-Secret`.

| Caso | Respuesta |
|---|---|
| `AUTOMATION_WEBHOOK_SECRET` no configurado en servidor | `500 { "error": "AUTOMATION_WEBHOOK_SECRET not configured" }` (R7-3) |
| header ausente o != secreto | `401 { "error": "Unauthorized" }` (R3-1) |
| `id` no existe | `404 { "error": "Automation not found" }` (R3-5) |
| ejecución ok / skipped | `200 { "status": "ok"\|"skipped", "summary": "..." }` (R3-4) |
| agente lanza excepción | `200 { "status": "error", "summary": "<mensaje>" }` — **nunca 5xx** para que n8n no reintente en bucle (R3-4) |

Request body: vacío o ignorado (el id va en el path; n8n no envía payload relevante).

```http
POST /api/automations/cm3x9.../execute
X-Automation-Secret: <AUTOMATION_WEBHOOK_SECRET>

→ 200 { "status": "ok", "summary": "Clasificados 3 emails, 1 ticket Jira creado" }
```

Implementación: valida secreto → `runAutomation(id)` → serializa `{ status, summary }`.

### 6.2 `POST /api/automations/:id/resync` (R6-5) — lo llama la UI

Auth: la del resto de `/api/automations` (sesión de usuario). **NO** requiere `X-Automation-Secret`.

Lógica: reintenta la sincronización con n8n:
- si la fila ya tiene `n8nWorkflowId` → `updateWorkflow` (o `createWorkflow` si `notFound`).
- si `n8nWorkflowId == null` → `createWorkflow`.
- persiste `n8nWorkflowId` + `syncStatus` resultante; activa/desactiva según `enabled`.

```http
POST /api/automations/cm3x9.../resync
→ 200 { "syncStatus": "synced", "n8nWorkflowId": "wf-42" }
```

Si n8n sigue caído → `200 { "syncStatus": "error", "n8nWorkflowId": null }` (no 5xx; la UI muestra el estado).

### 6.3 Exposición de `n8nConfigured` (R6-4)

`GET /api/automations` (o el endpoint que ya lista las automatizaciones del agente) añade el flag `n8nConfigured: n8n.isConfigured()` a la respuesta, para que la UI muestre el aviso "n8n no configurado". Cada `Automation` serializada incluye `n8nWorkflowId` y `syncStatus` (R6-6).

---

## 7. Frontend — `AutomationsPanel.tsx` (R6)

Cambios mínimos sobre el componente existente (no rediseño):

1. **Interfaz `Automation`** (línea 12): añadir
   ```ts
   n8nWorkflowId?: string | null;
   syncStatus?: "synced" | "pending" | "error";
   ```
2. **Badge de modo** (dentro de la tarjeta, junto a los `chip` de líneas 219-228):
   - `n8nWorkflowId && syncStatus === "synced"` → `<span className="chip">⚙️ n8n</span>`
   - cualquier otro caso → `<span className="chip">🕐 interno</span>` (R6-1)
3. **Badge de error + reintentar** (R6-2, R6-3): si `syncStatus === "error"`:
   - `<span className="chip text-amber-300">⚠ Error sync</span>`
   - botón "Reintentar sync" → `api("/api/automations/${a.id}/resync", { method: "POST" })` → `onChange()`.
4. **Aviso n8n no configurado** (R6-4): el componente recibe `n8nConfigured` (nueva prop o campo en la respuesta del listado). Si `false`, banner discreto arriba del panel: *"n8n no configurado — las automatizaciones usan el motor interno"*. **No** bloquea el botón de crear.
5. El texto existente de líneas 331-334 ("se ejecutará como workflow (n8n)…") se ajusta a copy condicional según `n8nConfigured`.

Sin cambios en `create`/`toggle`/`remove` (siguen usando body `{ id }`; AD9). Solo se añade `resync(id)`.

---

## 8. Infraestructura — docker-compose y env (R7)

### 8.1 docker-compose

**No existe `docker-compose.yml` en la raíz del repo** (verificado: glob sin resultados). La fase debe **crearlo** con el servicio n8n bajo perfil, o añadirlo si aparece uno antes. Servicio n8n bajo `profiles: ["n8n"]` (no arranca por defecto, R7-1):

```yaml
# docker-compose.yml (raíz)
services:
  n8n:
    image: n8nio/n8n:latest
    profiles: ["n8n"]            # sólo con: docker compose --profile n8n up
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_BASIC_AUTH_USER:-admin}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_BASIC_AUTH_PASSWORD:-changeme}
      - GENERIC_TIMEZONE=Europe/Madrid
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

> Si ya existe un `docker-compose.yml` (la tarea original menciona `3AStudioDB` en commits previos), **añadir** este bloque sin tocar los servicios existentes.

### 8.2 Primer arranque y obtención de API key (doc en la fase)

1. `docker compose --profile n8n up -d`
2. Abrir `http://localhost:5678`, completar el setup de owner (primer usuario).
3. `Settings → n8n API → Create an API key`. Copiar la key.
4. En `back/.env`: `N8N_BASE_URL=http://localhost:5678` y `N8N_API_KEY=<key>`.
5. Definir `AUTOMATION_WEBHOOK_SECRET` (string aleatorio largo) y `PUBLIC_URL`/`BACK_URL` accesible por n8n (si n8n corre en Docker y el backend en host, usar `http://host.docker.internal:4000`).
6. Reiniciar el backend. Las nuevas automatizaciones se sincronizarán; las existentes quedan en `pending` hasta un "Reintentar sync".

### 8.3 Variables de entorno (`back/.env.example`)

| Variable | Requerida para n8n | Default si ausente |
|---|---|---|
| `N8N_BASE_URL` | Sí | noop → cron interno |
| `N8N_API_KEY` | Sí | noop → cron interno |
| `AUTOMATION_WEBHOOK_SECRET` | Sí para `/execute` | 500 en `/execute` |
| `PUBLIC_URL` | Recomendada (reusa P1) | cae a `BACK_URL` |
| `BACK_URL` | Sí para builder | `http://localhost:4000` |

---

## 9. Esquema de datos (R8)

`schema.prisma`, modelo `Automation` (tras `enabled` / antes de `runs`):

```prisma
  n8nWorkflowId String?
  syncStatus    String  @default("pending") // synced | pending | error
```

Migración `back/prisma/migrate-automation-n8n.sql` (no destructiva):

```sql
-- migrate-automation-n8n.sql
-- Rollback: ALTER TABLE "Automation" DROP COLUMN "n8nWorkflowId", DROP COLUMN "syncStatus";

ALTER TABLE "Automation" ADD COLUMN "n8nWorkflowId" TEXT;
ALTER TABLE "Automation" ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'pending';
```

Aplicar: editar schema → ejecutar SQL manual (convención repo `migrate-*.sql`) o `prisma db push` → `prisma generate`. Las filas legacy quedan `n8nWorkflowId=null`, `syncStatus='pending'` → el cron las ejecuta (R5-2/R8-3, sin backfill).

---

## 10. Estrategia de tests (R9)

Framework: Vitest (back) + Playwright (front), ya en uso.

### Unit (back)

| Capa | Qué | Cómo |
|---|---|---|
| `workflow-builder` | `schedule` → nodo `scheduleTrigger` con `minutesInterval` correcto + nodo `httpRequest` con url `/:id/execute` y header `X-Automation-Secret` | `buildWorkflow({trigger:"schedule",config:{intervalMinutes:60}})`, assert estructura nodes/connections |
| `workflow-builder` | `intervalMinutes` undefined → default 5 (R2-2) | assert `minutesInterval === 5` |
| `workflow-builder` | `new_email` y `new_slack_message` → nodo `webhook` (no schedule) + mismo httpRequest | assert `nodes[0].type === "n8n-nodes-base.webhook"` |
| `workflow-builder` | trigger desconocido → lanza | `expect(() => buildWorkflow({trigger:"x"})).toThrow()` |
| `client` | noop sin env → `{status:"pending", workflowId:null}`, `isConfigured()===false` | borrar `N8N_BASE_URL`/`N8N_API_KEY` del env de test |
| `client` | n8n 200 → `{status:"synced", workflowId}` | mock `fetch` ok |
| `client` | n8n 404 → `{status:"error", notFound:true}` | mock `fetch` 404 |
| `client` | red caída/timeout → `{status:"error"}`, no lanza | mock `fetch` reject |
| `runAutomation` | crea `AutomationRun`, devuelve `{status,summary}` | mock `runAgent`, mock prisma; id inexistente → `{status:"error"}` |
| `runAutomations` skip | automatización `n8nWorkflowId="wf"` + `syncStatus="synced"` → **no** se ejecuta ni crea AutomationRun (R5-1) | spy sobre `runAutomation`, assert no llamado para esa fila |

### Integración (back, endpoint)

- `/execute` sin header → 401; con secreto incorrecto → 401; secreto no configurado → 500; id inexistente → 404; ok → 200 `{status,summary}` (R3 escenarios).

### E2E (front)

- Playwright: tarjeta con `syncStatus="synced"` muestra badge "⚙️ n8n"; con `syncStatus="error"` muestra "⚠ Error sync" + botón "Reintentar sync"; `n8nConfigured=false` muestra el aviso y no bloquea crear (backend mockeado por route interception).

Gate de cierre (tasks 8.4): `cd back && npm test` y `cd front && npm run build` en verde.

---

## 11. Riesgos / discrepancias / cuestiones abiertas

1. **Discrepancia nombre endpoint resync** (AD8): spec R6-5 dice `/sync`, la orquestación fija `/resync`. **Se usa `/resync`**. Si la implementación sigue el spec literal habría que renombrar; este diseño y la UI usan `/resync` de forma consistente. Confirmar.
2. **Discrepancia código auth status** (AD7): orquestación mencionó 403 para `/execute` sin secreto; spec R3-1 dice 401. **Se usa 401** (semántica correcta). 500 reservado para secreto no configurado en servidor.
3. **Rutas existentes con id en body vs path nuevo** (AD9): `/execute` y `/resync` usan `:id` en path; create/patch/delete siguen con `{ id }` en body para no romper `AutomationsPanel.tsx`. Inconsistencia de estilo aceptada y documentada.
4. **`docker-compose.yml` ausente en la raíz**: la fase debe crearlo (o fusionar el bloque n8n si aparece uno). El commit `fab33e9` menciona `3AStudioDB` en docker-compose; verificar en implementación si existe en otra ruta antes de crear uno nuevo.
5. **Query extra por automatización en el cron** (§4): `runAutomation(id)` recarga la fila con su `include`. Volumen bajo → aceptable; si el cron crece, pasar el objeto completo opcionalmente.
6. **Triggers de evento sin push externo** (nota spec): los workflows `new_email`/`new_slack_message` generan el nodo Webhook pero nadie empuja el evento (Gmail watch / Slack Events fuera de alcance, dependen de `oauth-integrations`). Mientras tanto el cron interno cubre esos triggers; pero ojo: si una de esas automatizaciones llega a `syncStatus="synced"`, el cron la **saltaría** (R5-1) y el webhook nunca se dispararía → no se ejecutaría nunca. **Mitigación:** para `new_email`/`new_slack_message` NO marcar `syncStatus="synced"` (dejar que el cron las siga ejecutando) hasta que exista el push externo, O activar el workflow sólo para `schedule`. Decisión recomendada: en esta fase, **sólo los triggers `schedule` se materializan como workflow activo en n8n**; los de evento se crean en n8n pero el cron los sigue ejecutando (no se marcan synced). Confirmar con humano.
7. **Rotación de `AUTOMATION_WEBHOOK_SECRET`**: el secreto va embebido (literal) en cada workflow n8n. Rotarlo exige re-sync de todos los workflows. Documentar en `.env.example`. Alternativa: usar `={{ $env.AUTOMATION_WEBHOOK_SECRET }}` y configurar la env en n8n (acopla n8n a la env, no elegido por defecto).
8. **Tamaño de `index.ts`**: ya cerca/encima de 500 líneas (P1 lo señaló a 707). Añadir 2 rutas + hooks lo crece más. Vigilar; si supera el umbral con holgura, extraer `routes/automations.ts` en fase posterior (no en esta, para no ampliar alcance).
