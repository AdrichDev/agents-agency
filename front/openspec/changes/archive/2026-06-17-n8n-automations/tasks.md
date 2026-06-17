# Tasks — n8n-automations

Orden: back schema → back motor → back cliente n8n → back rutas → infra → front → tests.

> Estado tras apply + verify (obs Engram 71/72). `[x]` = implementado y verificado,
> `[ ]` = pendiente (gaps de calidad de test señalados por el verify, no defectos).

## 1. Esquema de datos (back)

- [x] 1.1 Añadir `n8nWorkflowId String?` al modelo `Automation` en `schema.prisma`.
- [x] 1.2 Crear `back/prisma/migrate-automation-n8n.sql` (ALTER TABLE ADD COLUMN nullable).
- [x] 1.3 Aplicar con `prisma db push` y regenerar cliente Prisma.

## 2. Refactor del motor de ejecución (back)

- [x] 2.1 Extraer `runAutomation(id)` desde `runAutomations` en
      `back/src/lib/automations/engine.ts` (una sola automatización, crea `AutomationRun`).
- [x] 2.2 `runAutomations` pasa a iterar y llamar `runAutomation`.
- [ ] 2.3 Test unitario de `runAutomation` (mock `runAgent`).
      VERIFY GAP (W2): no existe; sólo hay asserts booleanos inline de la lógica de skip,
      sin mockear Prisma/`runAgent` ni ejecutar `runAutomation`/`runAutomations` reales.

## 3. Cliente n8n REST (back)

- [x] 3.1 Crear `back/src/lib/n8n/client.ts`: `createWorkflow`, `activateWorkflow`,
      `deactivateWorkflow`, `deleteWorkflow` contra `${N8N_BASE_URL}/api/v1/workflows`
      con header `X-N8N-API-KEY`.
- [x] 3.2 Manejar ausencia de `N8N_BASE_URL` (cliente "noop" con aviso, sin romper).
- [x] 3.3 Documentar `N8N_BASE_URL` y `N8N_API_KEY` en `back/.env.example`.

## 4. Builder de workflow (back)

- [x] 4.1 Crear `back/src/lib/n8n/workflow-builder.ts`: `buildWorkflow(automation)`
      → JSON n8n (trigger + nodo HTTP Request al backend). Ver design §3 (ejemplo JSON real).
- [x] 4.2 `schedule` → Schedule Trigger usando `config.intervalMinutes` (default 5).
- [x] 4.3 `new_email` / `new_slack_message` → nodo Webhook (path `automation-{id}`).
- [x] 4.4 Nodo HTTP Request → `POST ${PUBLIC_URL||BACK_URL}/api/automations/:id/execute` con
      header `X-Automation-Secret` (literal en build-time).
- [x] 4.5 Trigger desconocido → lanza Error (no llega a n8n).
- [x] 4.6 IMPORTANTE (design riesgo #6): sólo `schedule` se marca `syncStatus="synced"`
      (lo dispara n8n). `new_email`/`new_slack_message` se crean en n8n pero el cron los
      sigue ejecutando (no marcar synced) hasta que exista el push externo, o el evento
      no se dispararía nunca. RESUELTO así en apply (index.ts:568-571, 683-686).
- [x] 4.7 Test unitario del builder por cada tipo de trigger.

## 5. Endpoint de ejecución y wiring de ciclo de vida (back)

- [x] 5.1 `POST /api/automations/:id/execute` — autenticado por secreto compartido,
      llama `runAutomation(id)` y devuelve resultado.
- [x] 5.2 En `POST /api/automations`: tras crear `Automation`, `createWorkflow` y
      guardar `n8nWorkflowId` (limpieza si falla).
- [x] 5.3 En `PATCH /api/automations` (toggle `enabled`): activar/desactivar workflow.
- [x] 5.4 En `DELETE /api/automations`: borrar workflow en n8n antes/junto a la fila.

## 6. Infraestructura (opcional)

- [x] 6.1 Añadir servicio `n8n` opcional a `docker-compose.yml` (comentado/perfil).
- [x] 6.2 Documentar arranque de n8n y obtención de API key.
      Nota: instrucciones inline en comentarios de `docker-compose.yml` (no doc separada).

## 7. Frontend (front)

- [x] 7.1 En `AutomationsPanel.tsx`, badges ⚙️ n8n / 🕐 interno, ⚠ Error sync, botón Reintentar.
- [x] 7.2 Manejar el caso "n8n no configurado" en la UI (banner, sin bloquear).

## 8. Tests

- [x] 8.1 Vitest back: builder por trigger, cliente n8n mockeado (ok/404/red caída).
- [~] 8.2 Vitest back: auth del endpoint `/execute`.
      VERIFY GAP (W1): los tests simulan el `if` inline, no llaman al handler Express real
      vía supertest. No ejercitan extracción de header, lookup Prisma (404), ni el flujo
      de `runAutomation` → `res.json()`. Reescribir con supertest (patrón de channels.test.ts).
- [ ] 8.3 Playwright front: crear automatización y ver estado (mock). NO implementado.
- [x] 8.4 `cd back && npm test` (100/100) y `cd front && npm run build` en verde.
