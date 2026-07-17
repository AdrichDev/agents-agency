# Proposal — aa-lead-whatsapp-kickoff

## Intent

Cerrar el flujo de leads end-to-end: cuando entra un lead (formulario/landing),
que el **agente le escriba el PRIMER WhatsApp de forma proactiva** y arranque la
conversación. Hoy el canal WhatsApp de AA es **solo reactivo** (`channels/
whatsapp.ts sendMessage` manda solo `type:"text"`, que exige que el cliente
escriba primero dentro de la ventana 24h). Falta el disparo inicial
business-initiated, que en Meta obliga a una **plantilla aprobada** (`type:
"template"`) — inexistente en el código.

Con este cambio: **landing → kickoff → primer WhatsApp (plantilla) → el lead
responde → el agente califica / agenda (adapter `external_api`, ya construido) /
avisa al dueño**. Todo lo posterior al primer mensaje YA está; esto añade solo
el arranque.

## Problemas que resuelve

1. **No hay envío de plantilla.** `sendMessage` (`channels/whatsapp.ts:98-123`)
   solo hace `type:"text"` (mensaje de sesión). Un primer contacto proactivo a un
   lead que no ha escrito → fuera de ventana 24h → **requiere `type:"template"`**,
   que no existe.
2. **No hay disparo de arranque.** El único punto de entrada a una conversación
   es el webhook entrante de Meta (`whatsapp-webhook.ts`, reactivo). Nada permite
   que un lead recién capturado reciba el primer mensaje. El agente (cerebro,
   calificación, reserva vía CRM) solo se activa si el lead escribe primero.
3. **La conversación no se siembra.** Sin una `Conversation` pre-creada con
   `metadata.externalId = <teléfono>`, cuando el lead responda,
   `resolveConversation` (`webhook-shared.ts:26-42`) no encuentra contexto y el
   agente arranca en frío.

## Scope

### Sí — F1: `sendTemplate()` (canal WhatsApp, Meta)

- Nueva función en `channels/whatsapp.ts`: `sendTemplate(phoneNumberId,
  accessToken, to, template, variables)` → POST Graph API `type:"template"` con
  `template.name`, `template.language.code` y `components` (parámetros del cuerpo
  desde `variables`). Mismo patrón de fetch + manejo de error que `sendMessage`.

### Sí — F2: endpoint de kickoff + siembra de conversación

- `POST /api/leads/kickoff` (público, gated — ver Risks): recibe
  `{ agentId, nombre, telefono, email?, peticion? }`.
- Flujo:
  1. Resuelve el agente + sus credenciales WhatsApp (`ChannelConnection`
     provider=`whatsapp`, `decryptCreds`, patrón `whatsapp-webhook.ts`).
  2. Crea el Contacto en el CRM vía el adapter del agente
     (`resolveAgentBackendAdapter(agentId).guardarLead(...)`, external_api ya
     construido) — best-effort, no bloquea el WhatsApp.
  3. Envía la plantilla de primer contacto (`sendTemplate`).
  4. **Siembra la `Conversation`**: crea la fila con `channel="whatsapp"`,
     `metadata.externalId=<telefono normalizado>`, y persiste el texto de la
     plantilla como primer `Message` (role `assistant`) para que el agente tenga
     contexto cuando el lead responda.
  5. **Idempotencia**: si ya existe conversación para `(agentId, telefono)` →
     no reenvía plantilla (evita spam/duplicados).

### Sí — F3: configuración de la plantilla

- Nombre/idioma/mapa de variables de la plantilla de primer contacto:
  per-agente (v1 en `AgentDataBackend.notificationConfig` o campo pequeño) con
  fallback a env `META_LEAD_TEMPLATE_NAME`/`_LANG`. La plantilla debe estar
  **aprobada en Meta** (externo, HITL — fuera de scope de código).

### No — fuera de scope

- Aprobación de la plantilla en Meta (proceso externo, HITL).
- Secuencia de nurture / re-contacto tras 24h de silencio (otra plantilla) —
  follow-up.
- VAPI ("llámame ahora") — change aparte.
- n8n / Twilio — NO se usan; el canal es Meta ya integrado.

## Risks

- **Endpoint público abusable.** `/leads/kickoff` dispara envíos WhatsApp
  (coste + reputación del número). Mitigación: **token de kickoff per-agente**
  (secreto que porta la landing) + rate-limit por agente/IP + validación de
  teléfono. Sin token válido → 401. No exponer el envío sin gate.
- **Ventana 24h / plantilla.** El primer mensaje es plantilla estática (variables
  permitidas); el LLM NO redacta el primer texto. Solo tras la respuesta del lead
  el agente habla libre. Si la plantilla no está aprobada en Meta → Graph API
  rechaza (error honesto, no cuelga).
- **Idempotencia / doble kickoff.** Reintentos o doble submit del form no deben
  mandar 2 plantillas. Dedup por `(agentId, telefono)` sobre `Conversation`.
- **Aislamiento de credenciales.** Las creds WhatsApp son per-agente cifradas
  (`decryptCreds`); nunca globales. El kickoff usa las del agente indicado.

## Dependencies

- **aa-agent-external-crm-and-lead-qualification** (SHIPPED hoy):
  `resolveAgentBackendAdapter` + `guardarLead` (external_api) para crear el
  Contacto en el CRM.
- Canal WhatsApp Meta existente: `channels/whatsapp.ts` (`sendMessage` como
  patrón), `whatsapp-webhook.ts` (resolución de agente + creds),
  `webhook-shared.ts` (`resolveConversation`, `mergeConversationMetadata`,
  `decryptCreds`).
- `ChannelConnection` (unique `agentId_provider`) con creds WhatsApp cifradas.
- `Conversation`/`Message` (siembra). `chatWithAgent` (path reactivo posterior,
  sin cambios).
