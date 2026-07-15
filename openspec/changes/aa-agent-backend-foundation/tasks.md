# Tasks — aa-agent-backend-foundation

Orden crítico por dependencia: **modelo + migración → adapter → tools →
wizard → panel → notificaciones → implementación/verify**. Cada tarea está DONE
solo cuando su test está verde (convención del repo). `[reusa]` marca lo que se
apoya en código existente; `[nuevo]` lo que se crea de cero.

## Fase 1 — Modelo de datos + migración

- [ ] T1.1 [nuevo] `prisma/schema.prisma`: modelo `AgentDataBackend` (1:1 con
  Agent): `mode`, `dbUrlEncrypted?`, `dbSchema` (default `{}`, v1 esquema
  estándar por vertical → sin mapeo), `capabilities` (Json), `notificationConfig`
  (Json). Se declaran los campos `apiBaseUrl?`/`apiKeyEncrypted?` para
  forward-compat, pero v1 NO los cablea (external_api = backlog).
- [ ] T1.2 [nuevo] Migración **aditiva** + backfill: una fila por agente
  existente con `mode="none_yet"` (o modo inferido de `ecommerceConfig`); ningún
  DROP ni cambio destructivo.
- [ ] T1.3 [reusa] Retrocompat: mantener la lectura de
  `ecommerceConfig.orderStatusUrl`/`orderStatusApiKey` como fuente de
  `consultar_pedido` para agentes ya en prod (no romperlos).
- [ ] T1.4 Test T1 verde (`agent-data-backend.migration.test.ts`).

## Fase 2 — Adapter managed_db

- [ ] T2.1 [nuevo] Interface `AgentBackendAdapter`
  (`consultarDisponibilidad`, `crearReserva` + `cancelarReserva`, `guardarLead`,
  `consultarPedido`, `notificar`) según design.md §B.3.
- [ ] T2.2 [nuevo] Adapter `managed_db`: cliente `pg` contra `dbUrlEncrypted`
  descifrada con `encryptToken`/`decryptToken` [reusa]; queries por plantilla
  parametrizada por capability (esquema estándar por vertical). **Nada de SQL
  libre generado por LLM.**
- [ ] T2.3 [reusa] Disponibilidad delega en `booking/slots.ts:generateSlots`;
  reserva/lead reutilizan el motor `Service`/`AgentSchedule`/`Appointment`.
- [ ] T2.4 [nuevo] Provisionamiento con usuario Postgres de mínimo privilegio por
  agente (no service-role); documentar el patrón de cifrado de credenciales.
- [ ] T2.5 Test T2 verde (`managed-db-adapter.test.ts`).

## Fase 3 — Tools + handlers + retrocompat get_order_status

- [ ] T3.1 [nuevo] Tools `crear_reserva`, `consultar_disponibilidad`,
  `guardar_lead` + `consultar_pedido` (absorbe `get_order_status`).
- [ ] T3.2 [reusa] `buildAgentTools` (`engine.ts:69-108`) las añade
  condicionalmente según `AgentDataBackend.capabilities`.
- [ ] T3.3 [reusa] `executor.ts`: handlers que resuelven el adapter del agente y
  ejecutan cada tool; `consultar_pedido` cae al `orderStatusUrl` legado cuando no
  hay `managed_db`.
- [ ] T3.4 [reusa] `buildSystemPrompt`: guía de reserva REAL sustituye la guía
  de Google Calendar crudo (`engine.ts:180-189`) cuando hay backend con booking.
- [ ] T3.5 Test T3 verde (`agent-backend-tools.test.ts` + order-status legado).

## Fase 4 — Wizard: paso "Datos del negocio" (sustituye Skills)

- [ ] T4.1 [nuevo] Paso "Datos del negocio" obligatorio: qué opera el agente
  (reservas / leads / pedidos / solo información) y modo `managed_db` o
  `none_yet`; sin default silencioso.
- [ ] T4.2 [reusa] Validación en `blockedReason()`
  (`front/app/agents/new/page.tsx`) y en el schema zod de `POST /api/agents`
  (`routes/agents.ts:37`).
- [ ] T4.3 [reusa] OCULTAR el paso Skills: retirar `SkillsStep` del flujo,
  ajustar `useWizardSkills`/`ReviewStep` y dejar de exigir `skillIds`. **NO
  borrar** modelos `Skill`/`AgentSkill` ni marketplace `/skills` (motor y datos
  intactos).
- [ ] T4.4 Test T4 verde (`agents-create-backend.test.ts` + typecheck front +
  paso manual del wizard).

## Fase 5 — Reestructura del panel del agente

- [ ] T5.1 [nuevo] Tab **Datos del negocio**: modo del backend, estado,
  capabilities y credenciales cifradas; migrar aquí `EcommerceConfigPanel`.
- [ ] T5.2 [reusa] Fusionar **Canales e integraciones**
  (`ChannelConnectPanel` + `IntegrationsPanel`) + sección de config de
  notificaciones (destino Telegram, eventos).
- [ ] T5.3 [reusa] **Conocimiento**: guardar el archivo ORIGINAL en bucket
  privado nuevo `kb-files/<agentId>/` además de los chunks; GC al borrar la
  fuente; fuente "web inicial" con estado + re-ingesta.
- [ ] T5.4 [reusa] **Automatizaciones**: import de workflow n8n como camino
  principal (pegar JSON o elegir de nuestra instancia por API vía `n8n/client.ts`)
  con **scoping estricto por agente**; NL como azúcar; **historial de ejecuciones
  embebido** (absorbe LogsPanel). Es workflow-como-automatización (trigger), NO
  workflow-as-tool (v2).
- [ ] T5.5 [reusa] **Ajustes**: ocultar el selector de modelo en runtime
  `openclaw` con aviso honesto; QUITAR el selector de `reasoning_effort` del
  panel de agente; conservar nombre/prompt/temperatura.
- [ ] T5.6 [reusa] **Leads**: quitar la tab; la captura sigue en el engine;
  contador de leads en el dashboard.
- [ ] T5.7 [reusa] Relajar el lead-flow (`lead-flow.ts:57-91`): pedir nombre
  solo ante intención real, no bloquear la respuesta por adelantado; la captura
  (`record_lead_intent`) sigue funcionando.
- [ ] T5.8 Test T5 verde (`knowledge-original-storage.test.ts` +
  `automations-n8n-import.test.ts` + typecheck front + paso manual de tabs).

## Fase 6 — Notificaciones al cliente final (Telegram)

- [ ] T6.1 [nuevo] Dispatcher `notificar(evento, payload)` per-agente: canal v1
  Telegram, eventos `nueva_reserva` + `nuevo_lead` + `handoff`.
- [ ] T6.2 [reusa] Enviar vía `channels/telegram.ts:sendMessage`; redirigir los
  hooks existentes (`processNewLead`, handoff del executor) al dispatcher.
- [ ] T6.3 [reusa] Best-effort: un fallo de envío nunca rompe el chat ni la
  operación (patrón `notifications.ts:13-14`).
- [ ] T6.4 Test T6 verde (`notify-dispatcher.test.ts`).

## Fase 7 — Implementación / entrega + verificaciones finales

- [ ] T7.1 [reusa] Renombrar Deploy → **Implementación**: checklist por canal
  (widget, api, telegram/whatsapp con estado real de conexión); consolidar la
  apariencia del widget aquí.
- [ ] T7.2 [nuevo] Auto-verificación del widget: `widget.js` hace ping al
  backend al cargar; el panel muestra "instalado ✓" / "pendiente".
- [ ] T7.3 [nuevo] Guía self-serve para que el cliente instale el snippet
  (canales TG/WA los conecta la agencia).
- [ ] T7.4 Test T7 verde (test de ruta del ping + verificación visual del estado
  "instalado ✓").

## Verificaciones finales

- [ ] `back` test suite (node:test) verde: T1–T7.
- [ ] `front` typecheck sin errores tras retirar SkillsStep/effort.
- [ ] Retrocompat confirmada: agente en prod con `orderStatusUrl` sigue
  consultando pedidos.
- [ ] `prisma migrate status` OK; migración aplicada (código mergeado ≠
  funcionando).
- [ ] Paso manual del wizard (paso "Datos del negocio" obligatorio, salida
  rápida "solo información") y del panel (tabs de design.md §C, sin
  Skills/Logs/Leads).
- [ ] Scoping por agente verificado en el import n8n (sin cruce de tenants).
- [ ] `sdd-verify` / `/code-review` antes de commit.
