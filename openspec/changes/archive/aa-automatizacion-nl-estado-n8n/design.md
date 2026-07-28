# Design — aa-automatizacion-nl-estado-n8n

Honestidad. SIN cablear n8n, SIN migración. Regresión cero en el cron interno.

## §A. Evidencia

- `isConfigured()` env-based (`n8n/client.ts:17`), expuesto como `n8nConfigured` en el
  detalle del agente (`service.ts:491-498`) → prop a `AutomationsPanel`/`AutomationForm`/
  `AutomationImportForm`.
- Cron interno real: `cron.ts:9-23` → `engine.runAutomations()` (`engine.ts:142-162`)
  ejecuta NL (email/slack/schedule) vía `runAgent`; **salta** `synced` (`:152`) y
  `trigger:"imported"` (`:155`). Corre fijo a 5 min (`cron.ts:22`), ignora `intervalMinutes`.
- Import: `import.ts` camino ID → 503 si `!isConfigured()` (`:119-121`); camino JSON →
  noop, crea fila `imported` pending, pierde el JSON (`:90-149`, no hay columna workflowJson).
- Mensajes: banner `AutomationsPanel.tsx:44-48`; nota `AutomationForm.tsx:138-142`; aviso
  no bloqueante `AutomationImportForm.tsx:67-72`; badges `AutomationItem.tsx:46-54`.

## §B. F1 — Parar la pérdida del import JSON

- **Back** (`import.ts`): en el camino JSON, si `!n8n.isConfigured()` → lanzar
  `HttpError(503, "El motor de automatización (n8n) está apagado; no se pueden importar
  workflows ahora.")` **antes** de crear la fila (mismo trato honesto que el camino ID
  `:119-121`). No crear fila inerte, no perder nada en silencio.
- **Front** (`AutomationImportForm.tsx`): `canSubmit` incluye `n8nConfigured` — botón
  deshabilitado con n8n off + mensaje claro "El motor de automatización está apagado; los
  workflows importados requieren n8n. Las automatizaciones en lenguaje natural (email,
  Slack, programadas) sí funcionan con el motor interno." El aviso pasa de informativo a
  bloqueante.

## §C. F2 — Banner y nota honestos

- `AutomationsPanel.tsx:44-48` banner cuando `!n8nConfigured`: reescribir a algo como
  "Motor n8n apagado. Las automatizaciones en lenguaje natural (email, Slack, programadas)
  se ejecutan por el **motor interno** (revisa ~cada 5 min y requiere la integración
  conectada). Los **workflows importados** de n8n requieren n8n encendido." Tono honesto,
  sin "todo bien".
- `AutomationForm.tsx:138-142` nota: cuando n8n off, decir que se ejecutará por el motor
  interno con sondeo ~5 min (no push instantáneo) y que requiere el proveedor conectado
  (email/Slack). Quitar "Configura n8n para delegar…" ambiguo.

## §D. F3 — Estado por-ítem honesto

`AutomationItem.tsx:46-61` añadir señalización para `syncStatus:"pending"`:
- Si `trigger:"imported"` y n8n off → badge "requiere n8n (apagado)" en ámbar/rojo (esa
  automatización NO se ejecutará).
- Si NL (email/slack/schedule) y `pending` → badge "motor interno" + estado real por
  `lastRunAt`: "sin ejecutar aún" si `!lastRunAt`, o "última: {fecha}" si corrió. Distinguir
  claramente "corriendo por motor interno" de "guardada, aún no ejecutada".
- Mantener `synced`→"⚙️ n8n" y `error`→warning+reintento.

## §E. F4 — Honestidad del intervalo

- En `AutomationForm`/catálogo donde se elige `intervalMinutes`: nota "Con el motor interno
  la revisión es ~cada 5 min; el intervalo exacto solo aplica con n8n encendido." (Copy.)
  Honrar el intervalo real en el cron = follow-up (necesita next-run por automatización).

## §F. Tests (vitest back + front tsc)

- **F1 back**: `importWorkflowForAgent` camino JSON con `isConfigured()=false` → lanza 503
  y NO crea Automation (mock prisma: `create` no llamado). Con `isConfigured()=true` →
  comportamiento actual (regresión).
- **F1 front / F2 / F3 / F4**: `front npx tsc --noEmit` verde; render: import bloqueado con
  n8n off; banner/nota honestos; badge distinto para imported-off vs pending-NL.
- **Regresión**: el cron interno (`engine.runAutomations`) y la creación NL no cambian; las
  automatizaciones NL siguen ejecutándose con n8n off.

Regla del repo: DONE solo con test verde (o tsc + HITL en el front sin harness de componentes).
