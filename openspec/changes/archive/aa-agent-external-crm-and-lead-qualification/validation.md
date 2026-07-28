# Validation — aa-agent-external-crm-and-lead-qualification

## User story

Como creador de agentes de la agencia (y como 3A, mi propio negocio), quiero que
un agente de WhatsApp/Telegram trabaje un lead contra mi CRM real
(`creador_CRM`): que lo dé de alta como contacto, que consulte huecos y agende
si el lead quiere, y que **califique** si el lead está interesado o no
(hot/warm/cold) y me avise cuando haya un contacto caliente que atender — sin
aprovisionar una base de datos paralela y sin tocar código por cada agente.

## Acceptance criteria — F1 (backend external_api)

- **AC1**: un `AgentDataBackend` con `mode="external_api"`, `apiBaseUrl` y
  `businessId` resuelve a `ExternalApiAdapter` en `resolveAgentBackendAdapter`;
  el agente monta las tools `consultar_disponibilidad`, `crear_reserva`,
  `guardar_lead` (capabilities `reservas`+`leads`). `consultar_pedido` NO se
  monta.
- **AC2**: `guardar_lead` en un agente external_api hace `POST
  {apiBaseUrl}/api/public/leads` con `businessId` en el cuerpo y crea un
  `Contacto` real en `creador_CRM`; el `businessId`/datos viajan como dato, nunca
  interpolados en el path.
- **AC3**: `createAgent` acepta `mode="external_api"` solo con `apiBaseUrl` +
  `businessId`; falta cualquiera → 400. `apiKey` (si se da) se persiste cifrado
  `enc:v1:`, nunca en claro.
- **AC4**: capability no habilitada → el método del adapter rechaza antes de
  llamar a la red; `cancelarReserva`/`consultarPedido` sobre external_api
  devuelven "no soportado" honesto (no un fallo silencioso).
- **AC5 (regresión cero)**: un agente `managed_db` o `none_yet` produce
  exactamente las mismas tools, prompt y comportamiento que antes del cambio;
  `external_api` es invisible hasta configurar un agente en ese modo.
- **AC6**: `notificar` sobre external_api es best-effort — un fallo de aviso no
  lanza ni rompe el turno del chat (invariante `types.ts:84-85`).

## Acceptance criteria — F2 (calificación)

- **AC7**: la tool `calificar_lead(qualification, reason)` actualiza el `Lead`
  de la conversación (por `conversationId`) con `qualification` ∈
  `{hot,warm,cold}` y `qualificationReason`. Solo disponible con capability
  `leads`.
- **AC8**: `qualification="hot"` dispara aviso al dueño vía `notify-dispatcher`
  (evento `nuevo_lead`, `qualification:"hot"`), best-effort; `warm`/`cold` no
  avisan. Nada destructivo (los cold NO se borran ni descartan).
- **AC9**: el system prompt incluye la rúbrica HOT/WARM/COLD solo cuando `leads`
  está habilitado; con `leads` off, prompt idéntico al previo.
- **AC10**: la migración de `Lead.qualification`/`qualificationReason` es
  aditiva (default `unknown`), sin pérdida en filas existentes.

## Given-When-Then

**Escenario 1 (AC1/AC2): lead al CRM real vía external_api**
Given un agente con `AgentDataBackend{mode:"external_api", apiBaseUrl:"<crm>",
businessId:"cmr84anhw", capabilities:["reservas","leads"]}` y canal WhatsApp
When el lead escribe "hola, quiero información y dejo mi teléfono 600..."
Then el agente llama `guardar_lead` → `POST <crm>/api/public/leads` con
`{businessId:"cmr84anhw", nombre, telefono, peticion}`
And se crea un `Contacto` (tipo `lead`) en `creador_CRM`
And el `businessId` viaja en el body, no en la URL.

**Escenario 2 (AC7/AC8): calificación hot avisa al dueño**
Given el mismo agente, conversación en curso con un `Lead` ya capturado
When el lead dice "sí, quiero cita esta semana, ¿cuánto cuesta?"
Then el agente llama `calificar_lead("hot", "pide precio y acepta cita")`
And el `Lead` queda `qualification="hot"`, `qualificationReason` con la evidencia
And `dispatchNotification(agentId,"nuevo_lead",{qualification:"hot",...})` se
invoca (aviso "contacto que atender" al dueño por telegram), best-effort.

**Escenario 3 (AC5): regresión cero**
Given un agente de prod con `mode="managed_db"` (o sin backend)
When se despliega este cambio y atiende una conversación
Then las tools montadas y el system prompt son idénticos a los previos al
despliegue (external_api y `calificar_lead` invisibles hasta habilitarse).

**Escenario 4 (AC4): capability/method no soportado, honesto**
Given un agente external_api con capabilities `["leads"]` (sin `reservas`)
When el LLM intenta `crear_reserva`
Then el adapter rechaza por capability antes de tocar la red
And si intentara `cancelar_reserva`, recibe "no soportado" explícito (no un
error opaco ni un falso ok).

## Test por tarea

- T1.2 → `external-api-adapter.test.ts` (mapeo/gate/Bearer/timeout/notificar).
- T1.3 → resolver: external_api→adapter, managed_db intacto, faltantes→error.
- T1.4 → create: alta external_api, 400 sin apiBaseUrl, apiKey cifrado.
- T1.5 → gate: tools montadas en external_api, sin `consultar_pedido`, regresión.
- T2.1 → migración aditiva en BD local desechable.
- T2.2 → `calificar-lead.test.ts`: update por conversationId, hot notifica,
  warm/cold no, gate leads, upsert sin lead previo.
- T2.3 → rúbrica en prompt solo con leads on (función pura).
- T3.1 → regresión cero (asserts puros managed_db / sin backend).

Regla del repo: tarea DONE solo con su test verde; sin spec, cambios revertidos.
