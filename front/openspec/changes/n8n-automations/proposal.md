# Proposal — n8n-automations

Canal objetivo: **n8n**

## Intención

Hoy las automatizaciones creadas en `AutomationsPanel` se guardan como filas
`Automation` y se ejecutan por un cron interno (`runAutomations` cada 5 min vía
`/api/cron/automations`). No existe ningún workflow real: el "n8n" del que habla
la UI es solo una promesa.

Esta fase hace que cada automatización se **materialice como un workflow real en
n8n**, de modo que:

- Los triggers programados (`schedule`) se ejecutan como jobs de n8n (Schedule
  Trigger), no por el cron interno.
- Los triggers de evento (`new_email`, `new_slack_message`) usan un nodo Webhook
  de n8n que dispara cuando llega el evento.
- En todos los casos, n8n llama de vuelta al backend
  (`POST /api/automations/:id/execute`), que ejecuta el prompt con el motor del
  agente ya existente (`back/src/lib/automations/engine.ts` → `runAgent`).

Éxito = al crear/activar/borrar una automatización en la UI, el workflow
correspondiente aparece/activa/desaparece en n8n, y al dispararse ejecuta el
agente y registra un `AutomationRun`.

## Alcance (in-scope)

- **Cliente n8n REST** en el backend: `back/src/lib/n8n/client.ts` contra
  `/api/v1/workflows`, header `X-N8N-API-KEY`, base URL en `N8N_BASE_URL` (env).
- **Generación de workflow** según `config { service, action, intervalMinutes }`:
  - `schedule` → nodo Cron / Schedule Trigger con `intervalMinutes`.
  - `new_email` / `new_slack_message` → nodo Webhook (y registrar el webhook de
    origen del evento).
  - nodo **HTTP Request** → `POST {BACK_URL}/api/automations/:id/execute`.
- **Endpoint de ejecución**: `POST /api/automations/:id/execute` que invoca el
  motor existente (extraer la lógica por-automatización de `runAutomations` a una
  función `runAutomation(id)` reutilizable) y devuelve el resultado.
- **Persistencia**: añadir `n8nWorkflowId String?` al modelo `Automation`.
- **Ciclo de vida**:
  - crear `Automation` → crear workflow en n8n y guardar `n8nWorkflowId`.
  - toggle `enabled` → activar/desactivar workflow en n8n.
  - delete `Automation` → borrar workflow en n8n.
- **Docker compose**: servicio `n8n` **opcional** documentado (no obligatorio).

## Fuera de alcance (out-of-scope)

- Editor visual de workflows propio dentro de la app.
- Workflows multi-nodo complejos definidos por el usuario (solo el patrón
  trigger → HTTP Request al backend).
- Migrar/borrar el cron interno existente (se puede mantener como fallback o
  retirar en una fase posterior; decisión documentada, no forzada aquí).
- Alta de credenciales de n8n para Gmail/Slack dentro de n8n (el backend sigue
  siendo quien ejecuta el agente).

## Enfoque

1. **Datos**: `Automation.n8nWorkflowId String?`; SQL manual
   `back/prisma/migrate-automation-n8n.sql`.
2. **Cliente n8n**: crear/activar/desactivar/borrar workflow vía REST.
3. **Builder de workflow**: función que traduce `Automation` → JSON de workflow
   n8n (trigger + HTTP Request), según `trigger` y `config`.
4. **Refactor del motor**: extraer `runAutomation(id)` de `runAutomations` para
   reusar en el endpoint `/execute` (idempotente, con `AutomationRun`).
5. **Wiring de rutas**: enganchar create/patch/delete de `/api/automations` al
   cliente n8n.
6. **Infra**: bloque `n8n` opcional en `docker-compose.yml` + variables de entorno.
7. **Front**: `AutomationsPanel` ya describe el comportamiento; ajustar copy si
   procede y reflejar estado del workflow (creado/activo) si está disponible.

## Riesgos / preguntas abiertas

- **n8n disponible**: si `N8N_BASE_URL` no está configurado, crear automatización
  no debe romper. Decidir fallback: ¿guardar `Automation` sin workflow y degradar
  al cron interno, o rechazar? Se asume degradación con aviso.
- **Webhook de origen del evento**: `new_email`/`new_slack_message` requieren que
  algo notifique a n8n (push de Gmail/Slack). El nodo Webhook de n8n recibe, pero
  alguien debe empujar el evento. Dependencia de `oauth-integrations` para tener
  las conexiones; el registro de push (Gmail watch / Slack Events) puede quedar
  parcialmente fuera y documentarse.
- **Seguridad del endpoint `/execute`**: debe autenticarse (secreto compartido /
  header) para que solo n8n pueda dispararlo.
- **Consistencia**: si falla la creación del workflow tras crear la `Automation`,
  evitar filas huérfanas (transacción lógica / limpieza).
- **Rollback de schema**: la migración solo añade columna nullable (no
  destructiva); rollback = `ALTER TABLE ... DROP COLUMN n8nWorkflowId`.
- **Duplicidad con cron interno**: mantener ambos puede ejecutar dos veces;
  definir cuál manda.
