# Proposal — aa-automatizacion-nl-estado-n8n

Hijo H8 del plan maestro `aa-agentes-rediseno-operativo` (P2). Último del rediseño.

## Intent

La automatización en lenguaje natural NO es una fachada: un cron interno
(`cron.ts` → `engine.runAutomations`, cada 5 min) ejecuta las automatizaciones NL
(email/slack/schedule) vía `runAgent` **sin n8n**. El problema es de **honestidad**: la UI
oculta qué corre y qué no cuando n8n está apagado (que es el estado actual, deliberado). H8
hace honesta esa señalización y **para la pérdida silenciosa** del import JSON.

## Problemas verificados (`file:line`)

1. **Pérdida silenciosa del import JSON** — con n8n off, `import.ts:90-149` (camino JSON)
   NO persiste el `workflowJson` (no hay columna), crea una fila `trigger:"imported"`
   inerte que el cron **nunca** ejecuta (`engine.ts:155`), no recuperable ni re-syncable
   (el botón "Reintentar" solo aparece en `error`, no en `pending`, y el JSON ya se perdió).
   El camino "por ID" SÍ falla honesto (503, `import.ts:119-121`); el de JSON no. El front
   no bloquea (`AutomationImportForm.tsx:56` solo mira longitud).
2. **Framing "motor interno" engañoso** — `AutomationsPanel.tsx:46` + `AutomationForm.tsx:141`
   dan a entender ejecución garantizada; ocultan que (a) los importados quedan muertos, y
   (b) `schedule` ignora el `intervalMinutes` elegido (el cron corre fijo a 5 min,
   `cron.ts:22`).
3. **Estado por-ítem indistinto** — `syncStatus:"pending"` es cajón de sastre sin badge
   propio (`AutomationItem.tsx` solo pinta `synced`→n8n, resto→"interno", `error`→warning).
   Una automatización guardada-que-no-corre se ve igual que una que corre bien.

## Scope (honestidad; SIN cablear n8n, SIN migración)

- **F1 Parar la pérdida del import JSON:** con n8n off, el camino JSON de import debe fallar
  honesto igual que el de ID (503 "el motor de automatización (n8n) está apagado; no se
  pueden importar workflows ahora"), **sin** crear la fila inerte. Front: bloquear el submit
  del import cuando `!n8nConfigured` con mensaje claro.
- **F2 Banner/nota honestos:** reescribir el banner de `AutomationsPanel` y la nota de
  `AutomationForm` cuando n8n off — decir con claridad QUÉ corre (email/slack/schedule vía
  motor interno, sondeo ~5 min, requiere la integración conectada) y QUÉ no (workflows
  importados requieren n8n). Quitar el framing "todo bien por motor interno".
- **F3 Estado por-ítem honesto:** `AutomationItem` muestra un estado distinto para
  `pending` con n8n off ("guardada — se ejecutará por el motor interno" vs, para importados
  con n8n off, "requiere n8n (apagado)"). Distinguir "corriendo" de "guardada sin ejecutar"
  (usar `lastRunAt`).
- **F4 Honestidad del intervalo:** mensaje claro de que el motor interno revisa ~cada 5 min
  y que el intervalo elegido solo aplica con n8n (o honrar el intervalo en el cron —
  follow-up si es caro).

## Fuera de scope (follow-ups)
- Cablear/activar n8n, health check real de reachability (hoy `isConfigured()` es
  env-based, `client.ts:17`), Gmail watch / Slack Events push.
- Persistir `workflowJson` para "guardar y sincronizar luego" (necesitaría columna +
  migración; hoy el import JSON con n8n off se bloquea en su lugar).
- Honrar `intervalMinutes` real en el cron interno (tracking de next-run por automatización).

## Risks
- Bajo. Front (honestidad) + un guard backend en el import JSON. Regresión cero en el cron
  interno (que sigue ejecutando email/slack/schedule) y en las automatizaciones NL ya
  guardadas.

## Dependencies
- `back/src/lib/automations/import.ts` (guard JSON), `front/components/AutomationsPanel.tsx`,
  `front/components/automations/{AutomationForm,AutomationImportForm,AutomationItem}.tsx`,
  `n8nConfigured` (ya viaja en el detalle del agente, `service.ts:497`).
