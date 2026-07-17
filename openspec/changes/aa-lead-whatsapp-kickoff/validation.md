# Validation — aa-lead-whatsapp-kickoff

## User story

Como dueño de 3A (y como agencia para mis tenants), quiero que cuando entre un
lead por la landing, el agente le mande **automáticamente el primer WhatsApp**
(plantilla aprobada) y arranque la conversación — para que el lead se trabaje
end-to-end (califica, agenda, avisa) sin que yo mueva un dedo y sin esperar a que
el lead escriba primero.

## Acceptance criteria

- **AC1 (envío plantilla)**: `sendTemplate` hace POST Graph API `type:"template"`
  con `template.name`, `template.language.code` y los `body params` en orden;
  sin variables → sin `components`; respuesta no-2xx → lanza error honesto con
  status.
- **AC2 (gate)**: `POST /api/leads/kickoff` sin `token` válido del agente → 401;
  body inválido → 422; hay rate-limit por agente/IP. El envío WhatsApp NUNCA
  ocurre sin token válido.
- **AC3 (creds per-agente)**: el kickoff usa las credenciales WhatsApp del
  `agentId` indicado (`ChannelConnection` cifrada, `decryptCreds`); si el agente
  no tiene canal WhatsApp conectado → 409 honesto, sin enviar.
- **AC4 (Contacto en CRM)**: con adapter `external_api`+capability `leads`, el
  kickoff crea el Contacto en el CRM (`guardarLead`); si el adapter falla o no
  existe, el WhatsApp igualmente se envía (best-effort, no bloquea).
- **AC5 (siembra)**: tras enviar la plantilla, existe una `Conversation`
  (`channel="whatsapp"`, `metadata.externalId=<telefono>`, `leadFlow`,
  `source="kickoff"`) y un `Message` assistant con el texto renderizado; cuando
  el lead responda, `resolveConversation` la encuentra y el agente continúa con
  contexto.
- **AC6 (idempotencia)**: un segundo kickoff para el mismo `(agentId, telefono)`
  NO reenvía plantilla; responde `already_started`. Un doble submit no genera 2
  mensajes ni 2 conversaciones.
- **AC7 (fallo de envío)**: si Graph API rechaza la plantilla (p. ej. no
  aprobada), el endpoint responde 502 y **no** siembra conversación ni deja
  estado a medias.
- **AC8 (config)**: la plantilla se resuelve `notificationConfig.leadTemplate` >
  env > default; las variables (`bodyVars`) se rellenan con los datos del lead en
  el orden declarado.
- **AC9 (regresión cero)**: el webhook reactivo entrante y `chatWithAgent` se
  comportan idénticamente; el kickoff es aditivo.

## Given-When-Then

**Escenario 1 (AC2/AC3/AC5): kickoff feliz**
Given un agente con canal WhatsApp conectado, adapter external_api (capability
`leads`) y `leadTemplate` configurada, y un token de kickoff válido
When la landing hace `POST /api/leads/kickoff { agentId, nombre:"Ana",
telefono:"+34600...", token }`
Then se crea el Contacto en el CRM (`guardarLead`)
And se envía la plantilla de primer contacto por WhatsApp (Meta `type:"template"`)
And queda una `Conversation` whatsapp con `externalId="+34600..."` + un `Message`
assistant
And responde 200 `{ status:"started", conversationId }`.

**Escenario 2 (AC6): doble submit idempotente**
Given ya existe una conversación whatsapp para `(agentId, "+34600...")`
When llega un segundo kickoff con el mismo agentId+telefono
Then NO se llama `sendTemplate`
And responde 200 `{ status:"already_started" }` sin crear filas nuevas.

**Escenario 3 (AC2): sin token**
Given un `POST /api/leads/kickoff` sin `token` o con token inválido
When se procesa
Then responde 401 y no se envía ningún WhatsApp ni se crea nada.

**Escenario 4 (AC7): plantilla no aprobada**
Given una `leadTemplate` cuyo nombre no está aprobado en Meta
When el kickoff intenta enviarla
Then Graph API devuelve error, el endpoint responde 502
And NO se crea Conversation ni Message (sin estado a medias).

## Test por tarea

- T1.1 → `whatsapp-send-template.test.ts` (body template, sin-vars, error).
- T2.1 → gate: 401 sin token, 422 body inválido, rate-limit.
- T2.2 → creds: con/sin ChannelConnection (409).
- T2.3 → idempotencia: conversación previa → `already_started`, no reenvía.
- T2.4 → Contacto: `guardarLead` llamado; adapter null → sigue.
- T2.5 → plantilla+siembra: happy 200 (Conversation+Message); Graph fail → 502, 0 filas.
- T3.1 → config: precedencia notificationConfig>env>default; render vars.
- T4.1 → regresión cero (webhook + chatWithAgent).

Regla del repo: tarea DONE solo con su test verde; sin spec, cambios revertidos.
