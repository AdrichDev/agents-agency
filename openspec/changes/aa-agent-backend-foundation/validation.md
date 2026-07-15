# Validation — aa-agent-backend-foundation

## User story

Como operador de la agencia, cuando creo un agente quiero declarar dónde vive la
data de su negocio y que el agente pueda de verdad **reservar citas, guardar
leads y consultar pedidos** contra esa fuente; quiero un panel que refleje esa
realidad (sin controles decorativos) y que el dueño del negocio reciba un aviso
por Telegram cuando entra una reserva, un lead o un handoff.

## Acceptance criteria

- **AC1:** Existe `AgentDataBackend` (1:1 con Agent) con `mode ∈ {managed_db,
  none_yet}` en v1; la migración es aditiva y ningún agente en prod con
  `ecommerceConfig.orderStatusUrl` pierde la consulta de pedidos.
- **AC2:** El adapter `managed_db` responde disponibilidad, crea reserva y
  guarda lead contra la BD aprovisionada usando plantillas parametrizadas por
  capability (esquema estándar por vertical, sin SQL libre del LLM) y reutiliza
  `generateSlots` para disponibilidad.
- **AC3:** Con un agente que tiene backend con capability `reservas`/`leads`/
  `pedidos`, `buildAgentTools` expone `consultar_disponibilidad`,
  `crear_reserva`, `guardar_lead` y/o `consultar_pedido`, y el executor las
  ejecuta contra el adapter del agente. `get_order_status` sigue funcionando
  (retrocompat).
- **AC4:** El wizard tiene el paso obligatorio "Datos del negocio" (sustituye a
  Skills); no permite crear sin elegir `managed_db` o `none_yet`; "solo
  información" es elección explícita. Skills queda oculto sin borrar
  motor/datos/marketplace.
- **AC5:** El panel del agente muestra las tabs de design.md §C (Datos del
  negocio, Canales e integraciones, Conocimiento, Automatizaciones,
  Implementación, Ajustes); no hay tab Skills, Logs ni Leads; el selector de
  modelo se oculta en runtime `openclaw` con aviso y el selector de
  `reasoning_effort` desaparece del panel de agente.
- **AC6:** La captura de leads sigue activa en el engine; el lead-flow ya no
  bloquea la respuesta pidiendo nombre por adelantado (lo pide solo ante
  intención real); el contador de leads es visible en el dashboard.
- **AC7:** Al subir un adjunto de conocimiento, el archivo original se guarda en
  el bucket privado `kb-files/<agentId>/` además de los chunks; al borrar la
  fuente se hace GC del original.
- **AC8:** La tab Automatizaciones permite importar un workflow n8n (pegar JSON o
  elegir de nuestra instancia por API) con scoping por agente, y muestra el
  historial de ejecuciones embebido (absorbe Logs).
- **AC9:** Al ocurrir `nueva_reserva`, `nuevo_lead` o `handoff`, el dispatcher
  envía un aviso por Telegram al destino configurado del agente, best-effort
  (nunca rompe el chat).
- **AC10:** La tab Implementación muestra el snippet del widget y verifica su
  instalación con un ping (`widget.js` → "instalado ✓" en el panel).

## Escenarios Given-When-Then (uno por tarea)

**T1 — Modelo + migración (AC1)**
Given un agente en prod con `ecommerceConfig.orderStatusUrl` configurado
When se aplica la migración que crea `AgentDataBackend`
Then el agente obtiene una fila backfilleada con `mode="none_yet"` (o el modo
inferido de su ecommerceConfig) y `consultar_pedido`/`get_order_status` sigue
resolviendo contra el `orderStatusUrl` existente.

**T2 — Adapter managed_db (AC2)**
Given un `AgentDataBackend` con `mode="managed_db"`, `dbUrlEncrypted` válido y
capability `reservas`
When se llama `adapter.consultarDisponibilidad(servicio, rango)` y luego
`adapter.crearReserva(servicio, slot, contacto)`
Then la disponibilidad se calcula con `generateSlots` sobre la BD aprovisionada
y la reserva se inserta con una plantilla parametrizada (sin SQL libre),
devolviendo la reserva creada.

**T3 — Tools + handlers + retrocompat (AC3)**
Given un agente con backend `managed_db` y capabilities `[reservas, leads]`
When el LLM invoca `crear_reserva` y `guardar_lead` en el tool-loop
Then el executor resuelve el adapter del agente y ejecuta ambas contra su
backend; un agente legado con solo `orderStatusUrl` sigue exponiendo la consulta
de pedidos sin cambios de comportamiento.

**T4 — Wizard paso "Datos del negocio" (AC4)**
Given el wizard de creación de agente
When el usuario avanza sin elegir modo de backend
Then `blockedReason()` y el schema zod de `POST /api/agents` rechazan la
creación; al elegir "solo información" se crea con `mode="none_yet"` y el paso
Skills no aparece (motor/datos/marketplace intactos).

**T5 — Reestructura del panel (AC5, AC6, AC7, AC8)**
Given el detalle de un agente
When se abre el panel
Then se ven las tabs de design.md §C y no existen Skills/Logs/Leads; el selector
de modelo se oculta con aviso en `openclaw` y no hay selector de effort; el
contador de leads aparece en el dashboard; subir un adjunto persiste el original
en `kb-files/<agentId>/`; y la tab Automatizaciones importa un workflow n8n
scopeado por agente con historial embebido.

**T6 — Notificaciones Telegram (AC9)**
Given un agente con destino Telegram de notificación configurado
When se produce `nueva_reserva` (o `nuevo_lead`/`handoff`)
Then el dispatcher envía el aviso por Telegram best-effort y un fallo de envío no
interrumpe el flujo del chat ni la creación de la reserva.

**T7 — Implementación / auto-verificación widget (AC10)**
Given un agente con el snippet del widget pegado en el sitio del cliente
When `widget.js` hace ping al backend al cargar
Then la tab Implementación marca el canal widget como "instalado ✓"; si no hay
ping, queda como "pendiente".

## Test por tarea

- **T1:** `back/tests/agent-data-backend.migration.test.ts` (node:test) —
  crea/backfillea filas, verifica aditividad y retrocompat de `orderStatusUrl`.
- **T2:** `back/tests/managed-db-adapter.test.ts` — disponibilidad vía
  `generateSlots`, insert de reserva por plantilla, guardado de lead; assert de
  que no se construye SQL a partir de texto del LLM.
- **T3:** `back/tests/agent-backend-tools.test.ts` — `buildAgentTools`
  condicional por capability + `executeTool` enruta al adapter; caso legado
  `get_order_status` sigue verde (reusar/extender el test de order-status
  existente).
- **T4:** `back/tests/agents-create-backend.test.ts` (zod rechaza sin modo) +
  `front` typecheck y paso manual del wizard (paso "Datos del negocio", Skills
  ausente).
- **T5:** `back/tests/knowledge-original-storage.test.ts` (bucket
  `kb-files/<agentId>/` + GC) + `back/tests/automations-n8n-import.test.ts`
  (import JSON/API con scoping por agente) + `front` typecheck y paso manual de
  las tabs (ausencia Skills/Logs/Leads, avisos de modelo/effort, contador de
  leads en dashboard).
- **T6:** `back/tests/notify-dispatcher.test.ts` — dispatch por evento a
  Telegram, best-effort (fallo de envío no propaga excepción al chat).
- **T7:** `back` endpoint de ping cubierto por test de ruta; verificación visual
  manual del estado "instalado ✓" en la tab Implementación (widget.js real).
