# Design — aa-lead-whatsapp-kickoff

## §A. Enfoque

El kickoff es el **inverso del webhook reactivo**: en vez de "entra mensaje →
resuelve conversación → `chatWithAgent`", es "entra lead → crea Contacto →
manda plantilla → SIEMBRA la conversación" para que el path reactivo existente
la retome con contexto. No se toca `chatWithAgent` ni el webhook entrante: se
añade una función de canal (`sendTemplate`) y un endpoint que orquesta.

## §B. F1 — `sendTemplate()`

`back/src/lib/channels/whatsapp.ts` (junto a `sendMessage`):

```ts
export interface WhatsAppTemplateVar { type: "text"; text: string }

export async function sendTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  template: { name: string; language: string },
  bodyParams: string[]           // variables {{1}},{{2}}... del cuerpo
): Promise<void>;
```

Body Graph API:
```json
{ "messaging_product": "whatsapp", "to": "<to>", "type": "template",
  "template": { "name": "<name>", "language": { "code": "<language>" },
    "components": [{ "type": "body",
      "parameters": [ { "type": "text", "text": "<v1>" }, ... ] }] } }
```
- POST a `${META_GRAPH_BASE()}/${phoneNumberId}/messages`, `Authorization:
  Bearer`. Mismo manejo de error que `sendMessage` (throw con status+detalle).
- Si `bodyParams` vacío → `components` omitido (plantilla sin variables).

## §C. F2 — Endpoint `POST /api/leads/kickoff`

Router nuevo `back/src/routes/leads.ts` (montado en `index.ts`, **antes** de
`authenticate`, como el lane público). Body (zod):
`{ agentId: string, nombre: string, telefono: string, email?: string,
peticion?: string, token: string }`.

Flujo del handler:
1. **Auth/gate**: validar `token` contra el kickoff-token del agente (ver §D);
   inválido → 401. Rate-limit por `agentId`/IP (reusar `publicRateLimiter` o
   equivalente). Normalizar `telefono` (E.164) → clave de conversación.
2. **Resolver agente + creds**: `ChannelConnection.findUnique({
   agentId_provider: {agentId, provider:"whatsapp"} })` → `decryptCreds` →
   `{ phoneNumberId, accessToken }`. Sin conexión WhatsApp → 409 honesto.
3. **Idempotencia**: `resolveConversation(agentId, "whatsapp", telefono, {})`.
   Si ya existe → responder 200 `{ status:"already_started" }`, NO reenviar.
4. **Crear Contacto en CRM** (best-effort): `resolveAgentBackendAdapter(agentId)`
   → si adapter y capability `leads` → `guardarLead({nombre,email,telefono},
   peticion)`. Fallo → log, no bloquea el WhatsApp.
5. **Enviar plantilla**: `sendTemplate(phoneNumberId, accessToken, telefono,
   {name,language}, [nombre, ...])` con la config §D. Fallo Graph API → 502
   honesto (no se siembra conversación si no salió el mensaje).
6. **Sembrar conversación**: `prisma.conversation.create({ agentId,
   channel:"whatsapp", metadata:{ externalId: telefono, leadFlow:true,
   source:"kickoff" } })` + `prisma.message.create({ conversationId, role:
   "assistant", content: <texto renderizado de la plantilla> })` para dar
   contexto al primer turno reactivo.
7. Responder 200 `{ status:"started", conversationId }`.

## §D. F3 — Config de la plantilla

- v1: leer de `AgentDataBackend.notificationConfig.leadTemplate` =
  `{ name, language, bodyVars: ["nombre"] }` (qué variables y en qué orden), con
  fallback a env `META_LEAD_TEMPLATE_NAME` / `META_LEAD_TEMPLATE_LANG` (default
  `es`). El **kickoff-token** per-agente: reusar un secreto ya per-agente si
  existe, o añadir `notificationConfig.kickoffToken` (generado al configurar).
- El texto sembrado como `Message` assistant = render local de la plantilla con
  las variables (aprox., para contexto del LLM; el envío real lo hace Meta con la
  plantilla aprobada).
- La plantilla DEBE estar aprobada en Meta (externo). Sin aprobar → paso 5 falla
  con error claro; nada se siembra.

## §E. Seguridad

- Endpoint público SOLO tras token válido + rate-limit (anti-spam de WhatsApp).
- Teléfono validado/normalizado; nunca se interpola en URL.
- Creds WhatsApp per-agente descifradas en el handler, nunca en logs.
- Idempotencia evita reenvíos (coste + reputación del número).

## §F. Estrategia de test (vitest)

- **F1**: `fetch` mockeado → assert del body `type:"template"` correcto (name,
  language, components/parameters); `bodyParams` vacío → sin `components`; error
  Graph → throw con status.
- **F2**: handler con Prisma + adapter + sendTemplate mockeados → token inválido
  →401; sin ChannelConnection →409; conversación existente → `already_started`
  sin reenviar; happy path → crea Contacto (spy guardarLead), envía plantilla,
  crea Conversation + Message assistant, 200; fallo Graph → 502, NO siembra.
- **F3**: resolución de config (notificationConfig > env > default); render de
  variables.
- Regresión: webhook reactivo y `chatWithAgent` sin cambios de comportamiento.

Regla del repo: tarea DONE solo con su test verde; sin spec, cambios revertidos.
