# Spec — Channels (Telegram & WhatsApp)

**Estado**: Archived from P1 — telegram-whatsapp-bots (2026-06-12)

**Objetivo**: Desplegar agentes como bots reales de Telegram y WhatsApp con credenciales cifradas y webhook real.

---

## R0 — Modelo `ChannelConnection`

El sistema MUST contar con un modelo `ChannelConnection` separado del modelo `Integration`.

| Campo | Tipo | Restricción |
|---|---|---|
| `id` | String | `@id @default(cuid())` |
| `agentId` | String | FK → `Agent.id`, `onDelete: Cascade` |
| `provider` | String | `telegram` \| `whatsapp` |
| `credentials` | Json | Cifrado AES-256-GCM |
| `status` | String | `pending` \| `active` \| `error` |
| `webhookSecret` | String? | Token secreto |
| `createdAt` | DateTime | `@default(now())` |
| `updatedAt` | DateTime | `@updatedAt` |

Unicidad: `@@unique([agentId, provider])` — un agente MUST tener a lo sumo un bot activo por proveedor.

---

## R1 — Conexión Telegram

El sistema MUST permitir asociar un token de @BotFather a un agente y registrar un webhook activo.

**Variables de entorno**:
- `CHANNEL_ENCRYPTION_KEY` — clave AES-256 (32 bytes), requerida en arranque.
- `PUBLIC_URL` — URL HTTPS pública del backend.

**Escenarios**:

**R1-1 — Conexión exitosa**

```
GIVEN un agente con un token BotFather válido
  AND la variable PUBLIC_URL configurada con URL HTTPS
WHEN el cliente llama POST /api/channels/telegram/connect con { agentId, token }
THEN el backend llama GET https://api.telegram.org/bot{token}/getMe
 AND getMe devuelve 200 con datos del bot
 AND el backend genera un webhookSecret aleatorio (≥ 32 bytes hex)
 AND el backend llama setWebhook apuntando a {PUBLIC_URL}/api/channels/telegram/{agentId}
 AND se hace upsert de ChannelConnection con status=active, credentials cifradas
 AND el endpoint devuelve HTTP 200 con { status: "active", botName, botUsername }
```

**R1-2 — Token inválido**

```
GIVEN un token que no corresponde a ningún bot en Telegram
WHEN el cliente llama POST /api/channels/telegram/connect
THEN se hace upsert de ChannelConnection con status=error
 AND el endpoint devuelve HTTP 422 con { error: "Token de Telegram inválido" }
```

**R1-3 — PUBLIC_URL no configurada**

```
GIVEN que PUBLIC_URL no está definida en el entorno
WHEN el cliente llama POST /api/channels/telegram/connect
THEN el backend devuelve HTTP 503 con { error: "PUBLIC_URL no configurada" }
```

**R1-4 — Desconexión**

```
GIVEN un ChannelConnection con status=active para provider=telegram
WHEN el cliente llama DELETE /api/channels/telegram/{agentId}
THEN el backend llama deleteWebhook en la API de Telegram
 AND elimina el registro ChannelConnection
 AND devuelve HTTP 200
```

---

## R2 — Recepción y respuesta de mensajes Telegram

El sistema MUST recibir updates de Telegram, enrutarlos a `chatWithAgent` y responder por `sendMessage`.

**R2-1 — Mensaje de texto recibido**

```
GIVEN un ChannelConnection activo para agentId=A1
  AND Telegram envía POST /api/channels/telegram/A1 con header X-Telegram-Bot-Api-Secret-Token correcto
WHEN el endpoint procesa el update
THEN el sistema resuelve el agente por agentId=A1
 AND llama chatWithAgent(agentId, messageText, conversationId)
 AND envía la respuesta vía sendMessage(token, chatId, replyText)
 AND devuelve HTTP 200 con { ok: true }
```

**R2-2 — Idempotencia por update_id**

```
GIVEN que Telegram reenvía el mismo update dos veces
WHEN el endpoint recibe el segundo envío
THEN el sistema detecta que update_id ya fue procesado
 AND devuelve HTTP 200 sin volver a llamar chatWithAgent
```

**R2-3 — Tipo de mensaje no soportado (foto, sticker, etc.)**

```
GIVEN un update de Telegram que NO contiene message.text
WHEN el endpoint lo recibe
THEN el sistema NO llama chatWithAgent
 AND envía al usuario un mensaje de cortesía
 AND devuelve HTTP 200
```

**R2-4 — Validación del secret token**

```
GIVEN una petición entrante a POST /api/channels/telegram/{agentId}
  AND el header X-Telegram-Bot-Api-Secret-Token no coincide con webhookSecret
WHEN el endpoint procesa la petición
THEN devuelve HTTP 403
```

---

## R3 — Conexión WhatsApp (Meta Cloud API)

El sistema MUST permitir asociar credenciales de Meta Cloud API a un agente.

**Credenciales requeridas**:
- `phoneNumberId` — identificador del número de teléfono en Meta.
- `accessToken` — token permanente o de larga duración de Meta.
- `verifyToken` — cadena arbitraria que el cliente define.

**R3-1 — Registro de credenciales**

```
GIVEN un agente con credenciales válidas (phoneNumberId, accessToken, verifyToken)
WHEN el cliente llama POST /api/channels/whatsapp/connect
THEN el sistema cifra el conjunto con AES-256-GCM
 AND hace upsert de ChannelConnection con status=pending
 AND devuelve HTTP 200 con { status: "pending", webhookUrl: "..." }
```

**R3-2 — Verificación del webhook por Meta**

```
GIVEN un ChannelConnection con status=pending para provider=whatsapp
  AND Meta envía GET /api/channels/whatsapp/{agentId}?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
WHEN el endpoint recibe la petición
THEN el sistema descifra las credenciales del ChannelConnection
 AND compara hub.verify_token con el verifyToken almacenado
 AND si coinciden: actualiza status=active y devuelve HTTP 200 con body = hub.challenge
 AND si no: devuelve HTTP 403
```

**R3-3 — Desconexión WhatsApp**

```
GIVEN un ChannelConnection activo para provider=whatsapp
WHEN el cliente llama DELETE /api/channels/whatsapp/{agentId}
THEN el sistema elimina el registro ChannelConnection
 AND devuelve HTTP 200
```

---

## R4 — Recepción y respuesta de mensajes WhatsApp

El sistema MUST recibir eventos de Meta, filtrar mensajes de texto y responder por Graph API.

**R4-1 — Mensaje de texto recibido**

```
GIVEN un ChannelConnection activo para agentId=A1
  AND Meta envía POST /api/channels/whatsapp/A1 con payload que contiene un mensaje text
WHEN el endpoint procesa el evento
THEN el sistema extrae el número origen (from) y el texto del mensaje
 AND resuelve o crea una Conversation con channel="whatsapp" y metadata={ waFrom: from }
 AND llama chatWithAgent(agentId, messageText, conversationId)
 AND envía la respuesta vía POST https://graph.facebook.com/v21.0/{phoneNumberId}/messages
 AND devuelve HTTP 200
```

**R4-2 — Idempotencia por message id**

```
GIVEN que Meta reenvía el mismo evento dos veces
WHEN el endpoint recibe el segundo envío
THEN el sistema detecta que el message id ya fue procesado
 AND devuelve HTTP 200 sin llamar chatWithAgent
```

**R4-3 — Tipo de mensaje no soportado (imagen, audio, etc.)**

```
GIVEN un evento de Meta que contiene un mensaje de tipo distinto a text
WHEN el endpoint lo recibe
THEN el sistema NO llama chatWithAgent
 AND responde al número de origen con un mensaje de cortesía
 AND devuelve HTTP 200
```

---

## R5 — Cifrado de credenciales

El sistema MUST cifrar todas las credenciales de `ChannelConnection` en reposo usando AES-256-GCM.

**R5-1 — Cifrado al persistir**

```
GIVEN credenciales en texto plano
WHEN el sistema hace upsert de ChannelConnection
THEN el campo credentials en base de datos contiene el ciphertext
 AND el ciphertext incluye iv y authTag como parte del payload JSON
```

**R5-2 — Descifrado en memoria**

```
GIVEN un ChannelConnection con credentials cifradas
WHEN el sistema necesita usar las credenciales
THEN descifra en memoria usando CHANNEL_ENCRYPTION_KEY
 AND las credenciales en texto plano NO se escriben a disco ni logs
```

**R5-3 — API nunca expone credenciales completas**

```
GIVEN cualquier endpoint que devuelve datos de ChannelConnection
WHEN el cliente realiza GET /api/channels/{agentId}
THEN la respuesta NO incluye el token completo ni accessToken
 AND para Telegram: puede incluir los últimos 4 caracteres con máscara
 AND para WhatsApp: puede incluir los últimos 4 caracteres del accessToken con máscara
```

---

## R6 — UI — Panel de integraciones de canal

La pestaña Integraciones MUST mostrar un panel por canal (`telegram` | `whatsapp`).

**R6-1 — Estado desconectado**

```
GIVEN un agente sin ChannelConnection activo
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra una card con estado "Desconectado"
 AND muestra un formulario con campo "Token de BotFather" (Telegram) o credenciales (WhatsApp)
 AND muestra instrucciones paso a paso
 AND muestra el botón "Conectar"
```

**R6-2 — Estado conectado**

```
GIVEN un ChannelConnection con status=active
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra el estado "Conectado" con indicador visual verde
 AND muestra el nombre del bot (Telegram) o phoneNumberId enmascarado (WhatsApp)
 AND NO muestra los tokens ni credenciales completas
 AND muestra el botón "Desconectar"
```

**R6-3 — Estado pendiente (WhatsApp)**

```
GIVEN un ChannelConnection con status=pending para provider=whatsapp
WHEN el usuario navega a la pestaña Integraciones
THEN la UI muestra el estado "Pendiente de verificación"
 AND muestra la URL de webhook que el usuario debe registrar en Meta
 AND muestra instrucciones de verificación paso a paso
```

**R6-4 — Desconexión desde la UI**

```
GIVEN un ChannelConnection con status=active
WHEN el usuario pulsa "Desconectar" y confirma
THEN el frontend llama DELETE /api/channels/{provider}/{agentId}
 AND la UI actualiza el estado a "Desconectado" sin recargar
```

---

## Endpoints requeridos

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/api/channels/telegram/connect` | Conectar bot Telegram |
| POST | `/api/channels/whatsapp/connect` | Registrar credenciales WhatsApp |
| GET | `/api/channels/:agentId` | Estado de conexiones (sin credenciales) |
| DELETE | `/api/channels/telegram/:agentId` | Desconectar Telegram |
| DELETE | `/api/channels/whatsapp/:agentId` | Desconectar WhatsApp |
| POST | `/api/channels/telegram/:agentId` | Webhook receptor updates Telegram |
| GET | `/api/channels/whatsapp/:agentId` | Webhook verificación Meta |
| POST | `/api/channels/whatsapp/:agentId` | Webhook receptor eventos WhatsApp |

---

## Fuera de alcance

- Alta automática de número de WhatsApp.
- Verificación de negocio en Meta.
- Mensajes con multimedia o plantillas.
- Otros canales (Instagram, Messenger).
- Rotación automática de `CHANNEL_ENCRYPTION_KEY`.

---

## Technical Debt

**P3 — Test coverage**

- [ ] Playwright e2e para flujo de conexión canal (actualmente solo vitest unit).
- [ ] Skip cron con supertest real en test auth /execute.
- Estimated effort: 16h. Priority: medium.

---

## Implementation Status

- [x] Schema `ChannelConnection` + migration SQL
- [x] Crypto AES-256-GCM (`crypto.ts`)
- [x] Telegram client + routes
- [x] WhatsApp client + routes
- [x] Frontend UI (ChannelConnectPanel)
- [x] Vitest coverage (51/51 tests)
- [ ] Playwright e2e (out-of-scope P1, deferred to P3)
